-- Measure the membership path.
--
-- Until now nothing recorded who saw the plans or started a purchase. The app
-- now logs eight steps through log_funnel_event:
--   plans_viewed              the plans screen was shown (once per visit)
--   plan_sheet_opened         a plan's purchase sheet was opened
--   purchase_started          the App Store purchase was started
--   purchase_succeeded / purchase_cancelled / purchase_failed   how it ended
--   membership_invite_shown   an invitation to look at membership was on screen
--   membership_invite_tapped  she tapped it
--
-- 1. The eight stages are allowed. Each keeps only `source` (where she came
--    from: one label from _membership_path_sources(), anything else is stored
--    as 'unknown') and `tier` ('essential' or 'premium', when a plan is
--    involved). No other metadata is kept, whatever the client sends.
--    membership_invite_shown counts once per member, place and day.
-- 2. admin_funnel_stats() also returns membership_path_30d: how many members
--    reached each step in the last 30 days. Every key older admin builds read
--    is still returned unchanged.

-- ── 1. The stages and the labels ─────────────────────────────────────────────
-- src/lib/membershipPath.ts mirrors both lists.
CREATE OR REPLACE FUNCTION public._membership_path_stages()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY[
    'plans_viewed', 'plan_sheet_opened',
    'purchase_started', 'purchase_succeeded', 'purchase_cancelled', 'purchase_failed',
    'membership_invite_shown', 'membership_invite_tapped'
  ]::text[];
$$;
REVOKE EXECUTE ON FUNCTION public._membership_path_stages() FROM PUBLIC, anon, authenticated;

-- Where she came from. Screen and card names only; never anything she wrote.
CREATE OR REPLACE FUNCTION public._membership_path_sources()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY[
    'after_meeting', 'boundary_saved', 'chat_gate', 'crisis_command_plan', 'crisis_plan_review',
    'diy_planner', 'feature_gate', 'invitation_engine', 'invitation_setup', 'learn_library',
    'membership_guide', 'practice_completed', 'rehearsal_gate', 'support_groups', 'support_tab',
    'support_upgrade', 'today_locked_preview', 'today_membership', 'tracker_share'
  ]::text[];
$$;
REVOKE EXECUTE ON FUNCTION public._membership_path_sources() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.funnel_events DROP CONSTRAINT IF EXISTS funnel_events_stage_check;
ALTER TABLE public.funnel_events ADD CONSTRAINT funnel_events_stage_check
  CHECK (stage IN (
    'rsvp', 'attended', 'attended_10min', 'coaching_requested',
    'intervention_viewed', 'intervention_started',
    'brief_opened', 'brief_sent',
    'review_eligible', 'review_prompt_requested',
    'review_unavailable', 'review_manual_opened',
    'monday_call_share_requested', 'boundary_card_print_requested',
    'tool_opened', 'tool_finished',
    'plans_viewed', 'plan_sheet_opened',
    'purchase_started', 'purchase_succeeded', 'purchase_cancelled', 'purchase_failed',
    'membership_invite_shown', 'membership_invite_tapped'
  ));

-- Otherwise unchanged from 20261114110000_family_squares_attendance.
CREATE OR REPLACE FUNCTION public.log_funnel_event(
  p_stage text,
  p_metadata jsonb DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := public.my_account_id();
  v_metadata jsonb;
  v_tool text;
  v_meeting text;
  v_source text;
  v_today date := (now() AT TIME ZONE 'America/Los_Angeles')::date;
BEGIN
  IF v_account IS NULL THEN RETURN; END IF;
  IF p_stage NOT IN (
    'rsvp', 'attended', 'attended_10min', 'coaching_requested',
    'intervention_viewed', 'intervention_started',
    'brief_opened',
    'review_eligible', 'review_prompt_requested',
    'review_unavailable', 'review_manual_opened',
    'monday_call_share_requested', 'boundary_card_print_requested',
    'tool_opened', 'tool_finished',
    'plans_viewed', 'plan_sheet_opened',
    'purchase_started', 'purchase_succeeded', 'purchase_cancelled', 'purchase_failed',
    'membership_invite_shown', 'membership_invite_tapped'
  ) THEN
    RAISE EXCEPTION 'bad_stage';
  END IF;

  -- Distribution telemetry is deliberately data-minimized at the database
  -- boundary. A modified client cannot attach family or recovery content.
  IF p_stage IN ('monday_call_share_requested', 'boundary_card_print_requested') THEN
    v_metadata := jsonb_build_object(
      'language', CASE
        WHEN p_metadata ->> 'language' IN ('en', 'es') THEN p_metadata ->> 'language'
        ELSE 'unknown'
      END
    );
  ELSIF p_stage IN ('tool_opened', 'tool_finished') THEN
    -- Only an allowlisted tool name is kept; once per member, tool and day.
    v_tool := p_metadata ->> 'tool';
    IF v_tool IS NULL OR NOT (v_tool = ANY (public._usage_tools())) THEN
      RAISE EXCEPTION 'bad_tool';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.funnel_events e
      WHERE e.account_id = v_account AND e.stage = p_stage AND e.metadata ->> 'tool' = v_tool
        AND e.created_at >= date_trunc('day', now())
    ) THEN
      RETURN;
    END IF;
    v_metadata := jsonb_build_object('tool', v_tool);
  ELSIF p_stage = 'attended_10min' THEN
    -- She stayed at Family Squares for ten minutes or more. The meeting must
    -- be a Monday that is today or yesterday in Pacific time (the app reports
    -- within three hours of the Join tap), and counts once per meeting.
    v_meeting := p_metadata ->> 'meeting_date';
    IF v_meeting IS NULL OR v_meeting !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
      RAISE EXCEPTION 'bad_meeting_date';
    END IF;
    BEGIN
      IF extract(isodow FROM v_meeting::date) <> 1 OR v_meeting::date NOT BETWEEN v_today - 1 AND v_today THEN
        RAISE EXCEPTION 'bad_meeting_date';
      END IF;
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
      -- "2026-13-45" looks like a date and is not one.
      RAISE EXCEPTION 'bad_meeting_date';
    END;
    IF EXISTS (
      SELECT 1 FROM public.funnel_events e
      WHERE e.account_id = v_account AND e.stage = 'attended_10min'
        AND e.metadata ->> 'meeting_date' = v_meeting
    ) THEN
      RETURN;
    END IF;
    v_metadata := jsonb_build_object(
      'meeting_date', v_meeting,
      'source', CASE
        WHEN p_metadata ->> 'source' IN ('today', 'support', 'push') THEN p_metadata ->> 'source'
        ELSE 'unknown'
      END
    );
  ELSIF p_stage = ANY (public._membership_path_stages()) THEN
    -- The membership path keeps only where she came from (a label from the
    -- list above, or 'unknown') and which plan, when there is one. Nothing a
    -- modified client adds is stored.
    v_source := CASE
      WHEN p_metadata ->> 'source' = ANY (public._membership_path_sources()) THEN p_metadata ->> 'source'
      ELSE 'unknown'
    END;
    -- An invitation left on screen counts once per member, place and day.
    IF p_stage = 'membership_invite_shown' AND EXISTS (
      SELECT 1 FROM public.funnel_events e
      WHERE e.account_id = v_account AND e.stage = p_stage AND e.metadata ->> 'source' = v_source
        AND e.created_at >= date_trunc('day', now())
    ) THEN
      RETURN;
    END IF;
    v_metadata := jsonb_build_object('source', v_source);
    IF p_metadata ->> 'tier' IN ('essential', 'premium') THEN
      v_metadata := v_metadata || jsonb_build_object('tier', p_metadata ->> 'tier');
    END IF;
  ELSE
    v_metadata := coalesce(p_metadata, '{}'::jsonb);
  END IF;

  INSERT INTO public.funnel_events (account_id, stage, metadata)
  VALUES (v_account, p_stage, v_metadata);
END;
$$;
REVOKE ALL ON FUNCTION public.log_funnel_event(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_funnel_event(text, jsonb) TO authenticated;

-- ── 2. The admin figure ──────────────────────────────────────────────────────
-- Otherwise unchanged from 20261114110000_family_squares_attendance.
CREATE OR REPLACE FUNCTION public.admin_funnel_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_latest date := public._family_squares_latest_meeting_date(now());
  -- The coming meeting: tonight's until it ends at 8 PM Pacific, then next Monday's.
  v_next date := CASE
    WHEN now() < (v_latest + time '20:00') AT TIME ZONE 'America/Los_Angeles' THEN v_latest
    ELSE v_latest + 7
  END;
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  WITH mood AS (
    SELECT account_id, count(*) FILTER (WHERE mood <= 2) AS low_days
    FROM public.checkins
    WHERE created_at >= now() - interval '7 days'
    GROUP BY account_id
  ),
  trk AS (
    SELECT account_id,
      count(*) FILTER (WHERE kind = 'warning') AS warn,
      count(*) FILTER (WHERE kind = 'recovery') AS recov
    FROM public.tracker_logs
    WHERE week >= current_date - 14
    GROUP BY account_id
  ),
  scored AS (
    SELECT a.id,
      (coalesce(m.low_days, 0) * 10)
      + (greatest(coalesce(t.warn, 0) - coalesce(t.recov, 0), 0) * 10)
      + public._loved_one_status_weight(lo.stage, lo.status, lo.stage_changed_at, lo.status_changed_at,
          coalesce(t.warn, 0)::integer, now()) AS score
    FROM public.accounts a
    LEFT JOIN mood m ON m.account_id = a.id
    LEFT JOIN trk t ON t.account_id = a.id
    LEFT JOIN public.loved_ones lo ON lo.account_id = a.id
  ),
  weeks AS (
    SELECT (v_next - 7 * g) AS meeting_date,
      -- Until the Tuesday 2 AM Pacific reset after a meeting, its RSVPs are still in session_rsvps.
      now() < (((v_next - 7 * g) + 1) + time '02:00') AT TIME ZONE 'America/Los_Angeles' AS live
    FROM generate_series(0, 3) AS g
  )
  SELECT jsonb_build_object(
    'members', (SELECT count(*) FROM public.accounts),
    'paid_accounts', (SELECT count(DISTINCT e.account_id)
      FROM public.entitlements e
      WHERE e.source IN ('revenuecat', 'stripe', 'web')
        AND e.tier IN ('essential', 'premium')
        AND (e.expires_at IS NULL OR e.expires_at > now())),
    'onboarded_loved_one', (SELECT count(*) FROM public.loved_ones),
    'free_rsvps', (SELECT count(DISTINCT sr.account_id)
      FROM public.session_rsvps sr
      WHERE sr.session_id = public.family_squares_session_id()
        AND sr.status = 'going'),
    'attended', (SELECT count(DISTINCT account_id) FROM public.funnel_events WHERE stage = 'attended'),
    'coaching_requested', (SELECT count(DISTINCT account_id) FROM public.coaching_bookings),
    'coaching_confirmed', (SELECT count(DISTINCT account_id) FROM public.coaching_bookings WHERE status IN ('confirmed', 'completed')),
    'intervention_viewed', (SELECT count(DISTINCT account_id) FROM public.funnel_events WHERE stage = 'intervention_viewed'),
    'intervention_started', (SELECT count(DISTINCT account_id) FROM public.funnel_events WHERE stage = 'intervention_started'),
    'bands', jsonb_build_object(
      'calm', (SELECT count(*) FROM scored WHERE score < 10),
      'watch', (SELECT count(*) FROM scored WHERE score >= 10 AND score < 30),
      'elevated', (SELECT count(*) FROM scored WHERE score >= 30 AND score < 60),
      'crisis', (SELECT count(*) FROM scored WHERE score >= 60)
    ),
    -- Newest first. rsvps/declined are null for a meeting whose RSVPs were
    -- cleared before counts were kept (meetings before this migration).
    'family_squares_weeks', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'meeting_date', w.meeting_date,
        'rsvps', coalesce(s.rsvps, CASE WHEN w.live THEN c.going END),
        'declined', coalesce(s.declined, CASE WHEN w.live THEN c.declined END),
        -- Tapped Join around the meeting (from 5 PM Pacific, since people
        -- join early, to half an hour after, as the Tuesday note counts it).
        -- All four figures count the same people: Spanish members join
        -- La Sobremesa and admins host, so neither is counted in any of them
        -- (rsvps and declined: see _family_squares_rsvp_counts).
        'join_taps', (SELECT count(DISTINCT e.account_id)
          FROM public.funnel_events e
          JOIN public.accounts a ON a.id = e.account_id
          WHERE e.stage = 'attended'
            AND e.created_at >= (w.meeting_date + time '17:00') AT TIME ZONE 'America/Los_Angeles'
            AND e.created_at < (w.meeting_date + time '20:30') AT TIME ZONE 'America/Los_Angeles'
            AND coalesce(a.locale, 'en') NOT LIKE 'es%'
            AND NOT public._dispatcher_admin(e.account_id)),
        'attended_10min', (SELECT count(DISTINCT e.account_id)
          FROM public.funnel_events e
          JOIN public.accounts a ON a.id = e.account_id
          WHERE e.stage = 'attended_10min'
            AND e.metadata ->> 'meeting_date' = w.meeting_date::text
            AND coalesce(a.locale, 'en') NOT LIKE 'es%'
            AND NOT public._dispatcher_admin(e.account_id))
      ) ORDER BY w.meeting_date DESC), '[]'::jsonb)
      FROM weeks w
      LEFT JOIN public.family_squares_meeting_stats s ON s.meeting_date = w.meeting_date
      CROSS JOIN LATERAL public._family_squares_rsvp_counts(w.meeting_date) c),
    -- The membership path: members (not events) at each step in the last
    -- 30 days. Admins testing the screens are not counted.
    'membership_path_30d', (SELECT jsonb_object_agg(s.stage, (
        SELECT count(DISTINCT e.account_id)
        FROM public.funnel_events e
        WHERE e.stage = s.stage
          AND e.created_at >= now() - interval '30 days'
          AND NOT public._dispatcher_admin(e.account_id)))
      FROM unnest(public._membership_path_stages()) AS s(stage))
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_funnel_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_funnel_stats() TO authenticated;
