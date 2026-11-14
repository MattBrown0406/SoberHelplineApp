-- Real attendance for Family Squares (the free Monday meeting).
--
-- Until now the funnel stage 'attended' only meant "tapped Join". The app now
-- also logs 'attended_10min' when a member comes back to the app ten minutes
-- or more after tapping Join during the meeting: she was actually there.
--
-- 1. 'attended_10min' is an allowed funnel stage. The server keeps only the
--    meeting date and where she joined from, once per member and meeting.
-- 2. family_squares_meeting_stats keeps each meeting's RSVP counts. RSVPs are
--    cleared every Tuesday at 2 AM Pacific, so without it last night's numbers
--    are gone by morning. The weekly reset records them just before it clears
--    (see 20261114120000).
-- 3. admin_funnel_stats() also returns family_squares_weeks: for the coming
--    meeting and the three before it, RSVPs, "can't make it" answers, Join
--    taps and members who stayed ten minutes. Every key older admin builds
--    read is still returned unchanged.

-- ── 1. The new stage ─────────────────────────────────────────────────────────
ALTER TABLE public.funnel_events DROP CONSTRAINT IF EXISTS funnel_events_stage_check;
ALTER TABLE public.funnel_events ADD CONSTRAINT funnel_events_stage_check
  CHECK (stage IN (
    'rsvp', 'attended', 'attended_10min', 'coaching_requested',
    'intervention_viewed', 'intervention_started',
    'brief_opened', 'brief_sent',
    'review_eligible', 'review_prompt_requested',
    'review_unavailable', 'review_manual_opened',
    'monday_call_share_requested', 'boundary_card_print_requested',
    'tool_opened', 'tool_finished'
  ));

-- Otherwise unchanged from 20261104120000_tool_usage_events.
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
    'tool_opened', 'tool_finished'
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
  ELSE
    v_metadata := coalesce(p_metadata, '{}'::jsonb);
  END IF;

  INSERT INTO public.funnel_events (account_id, stage, metadata)
  VALUES (v_account, p_stage, v_metadata);
END;
$$;
REVOKE ALL ON FUNCTION public.log_funnel_event(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_funnel_event(text, jsonb) TO authenticated;

-- ── 2. RSVP counts that outlive the Tuesday reset ────────────────────────────
CREATE TABLE IF NOT EXISTS public.family_squares_meeting_stats (
  meeting_date date PRIMARY KEY,
  rsvps integer NOT NULL CHECK (rsvps >= 0),
  declined integer NOT NULL CHECK (declined >= 0),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
-- Counts only, no member data. Read through admin_funnel_stats(), never directly.
ALTER TABLE public.family_squares_meeting_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.family_squares_meeting_stats FROM PUBLIC, anon, authenticated;

-- "Going" and "can't make it" answers for one meeting. A dated row (4.2+)
-- names its meeting; an undated row (4.1) belongs to the meeting after the
-- call it was made after (the rule the Tuesday follow-up already uses).
CREATE OR REPLACE FUNCTION public._family_squares_rsvp_counts(p_meeting_date date)
RETURNS TABLE(going integer, declined integer)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT count(*) FILTER (WHERE r.status = 'going')::integer,
         count(*) FILTER (WHERE r.status = 'declined')::integer
  FROM public.session_rsvps r
  WHERE r.session_id = public.family_squares_session_id()
    AND (r.family_squares_meeting_date = p_meeting_date
      OR (r.family_squares_meeting_date IS NULL
        AND r.created_at > ((p_meeting_date - 7) + time '20:00') AT TIME ZONE 'America/Los_Angeles'
        AND r.created_at < (p_meeting_date + time '20:00') AT TIME ZONE 'America/Los_Angeles'));
$$;
REVOKE ALL ON FUNCTION public._family_squares_rsvp_counts(date) FROM PUBLIC, anon, authenticated;

-- Called by the weekly reset just before it clears that meeting's RSVPs.
CREATE OR REPLACE FUNCTION public._family_squares_record_meeting_stats(p_meeting_date date)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF p_meeting_date IS NULL THEN RETURN; END IF;
  INSERT INTO public.family_squares_meeting_stats (meeting_date, rsvps, declined, recorded_at)
  SELECT p_meeting_date, c.going, c.declined, now()
  FROM public._family_squares_rsvp_counts(p_meeting_date) c
  ON CONFLICT (meeting_date) DO UPDATE
    SET rsvps = EXCLUDED.rsvps, declined = EXCLUDED.declined, recorded_at = EXCLUDED.recorded_at;
END;
$$;
REVOKE ALL ON FUNCTION public._family_squares_record_meeting_stats(date) FROM PUBLIC, anon, authenticated;

-- ── 3. The admin figure, per meeting ─────────────────────────────────────────
-- Otherwise unchanged from 20261004100300_situation_status_decay.
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
        -- Tapped Join around the meeting (an hour before to half an hour
        -- after, as the Tuesday note counts it). Spanish members join
        -- La Sobremesa and admins host, so neither is counted.
        'join_taps', (SELECT count(DISTINCT e.account_id)
          FROM public.funnel_events e
          JOIN public.accounts a ON a.id = e.account_id
          WHERE e.stage = 'attended'
            AND e.created_at >= (w.meeting_date + time '18:00') AT TIME ZONE 'America/Los_Angeles'
            AND e.created_at < (w.meeting_date + time '20:30') AT TIME ZONE 'America/Los_Angeles'
            AND coalesce(a.locale, 'en') NOT LIKE 'es%'
            AND NOT public._dispatcher_admin(e.account_id)),
        'attended_10min', (SELECT count(DISTINCT e.account_id)
          FROM public.funnel_events e
          WHERE e.stage = 'attended_10min'
            AND e.metadata ->> 'meeting_date' = w.meeting_date::text
            AND NOT public._dispatcher_admin(e.account_id))
      ) ORDER BY w.meeting_date DESC), '[]'::jsonb)
      FROM weeks w
      LEFT JOIN public.family_squares_meeting_stats s ON s.meeting_date = w.meeting_date
      CROSS JOIN LATERAL public._family_squares_rsvp_counts(w.meeting_date) c)
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_funnel_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_funnel_stats() TO authenticated;
