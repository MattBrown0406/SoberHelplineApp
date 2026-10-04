-- Loved-one status can come back down. Re-runnable.
--
-- my_situation() weighted loved_ones.status alone (escalating 25, crisis 35)
-- and ignored the stage the member saves on the recovery pathway card. The
-- tracker sets 'escalating' after a warning spike and nothing lowered it, so a
-- family whose loved one entered treatment stayed "elevated" forever.
--
-- Now:
-- * The saved stage decides the weight (via _invitation_recovery_phase, as the
--   Invitation Engine does): in treatment / recovery 0, returning home 5,
--   considering treatment 10, active use / return to use 15. No stage (or
--   "unsure") keeps the old status weights.
-- * An 'escalating' / 'crisis' status still adds its weight while it is
--   current. It stops being current when a treatment/recovery stage is saved
--   after it, and a tracker escalation fades after 14 days with no new warning
--   spike (fewer than 3 warning signs in the last 14 days) — it then counts as
--   active use.
-- * loved_ones.status_changed_at records when the status was last set
--   (set_loved_one_status always refreshes it). Existing rows use updated_at,
--   the latest moment the status could have been set.

ALTER TABLE public.loved_ones ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
UPDATE public.loved_ones SET status_changed_at = updated_at WHERE status_changed_at IS NULL;

CREATE OR REPLACE FUNCTION public._loved_ones_status_changed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status_changed_at := coalesce(NEW.status_changed_at, clock_timestamp());
  ELSIF NEW.status_changed_at IS DISTINCT FROM OLD.status_changed_at THEN
    NULL;  -- set explicitly (set_loved_one_status re-asserting a status)
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._loved_ones_status_changed_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS loved_ones_status_changed_at ON public.loved_ones;
CREATE TRIGGER loved_ones_status_changed_at
  BEFORE INSERT OR UPDATE ON public.loved_ones
  FOR EACH ROW EXECUTE FUNCTION public._loved_ones_status_changed_at();

CREATE OR REPLACE FUNCTION public.set_loved_one_status(p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := my_account_id();
BEGIN
  IF v_account IS NULL THEN RAISE EXCEPTION 'no_account'; END IF;

  -- Setting a status (even the same one again, e.g. a new warning spike)
  -- makes it current.
  INSERT INTO loved_ones (account_id, status, updated_at, status_changed_at)
  VALUES (v_account, p_status, now(), clock_timestamp())
  ON CONFLICT (account_id)
  DO UPDATE SET status = EXCLUDED.status, updated_at = now(), status_changed_at = clock_timestamp();
END;
$$;

REVOKE ALL ON FUNCTION public.set_loved_one_status(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_loved_one_status(text) TO authenticated;

-- The status that still applies. NULL when there is no loved-one row.
CREATE OR REPLACE FUNCTION public._loved_one_effective_status(
  p_stage text, p_status text, p_stage_changed_at timestamptz, p_status_changed_at timestamptz,
  p_recent_warnings integer, p_now timestamptz)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_phase text;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('escalating', 'crisis') THEN
    RETURN p_status;
  END IF;
  v_phase := CASE WHEN p_stage IS NOT NULL THEN public._invitation_recovery_phase(p_stage, p_status) END;
  -- A treatment / recovery stage saved after the escalation replaces it.
  IF v_phase IN ('in_treatment', 'returning_home', 'early_recovery_30', 'early_recovery_90', 'ongoing_recovery')
     AND p_stage_changed_at IS NOT NULL
     AND (p_status_changed_at IS NULL OR p_stage_changed_at > p_status_changed_at) THEN
    RETURN CASE WHEN v_phase = 'in_treatment' THEN 'in_treatment' ELSE 'stable' END;
  END IF;
  -- The tracker's escalation fades after 14 days without a new warning spike.
  IF p_status = 'escalating' AND coalesce(p_recent_warnings, 0) < 3
     AND (p_status_changed_at IS NULL OR p_status_changed_at < p_now - interval '14 days') THEN
    RETURN 'using';
  END IF;
  RETURN p_status;
END;
$$;

CREATE OR REPLACE FUNCTION public._loved_one_status_weight(
  p_stage text, p_status text, p_stage_changed_at timestamptz, p_status_changed_at timestamptz,
  p_recent_warnings integer, p_now timestamptz)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_stage IS NULL OR public._invitation_recovery_phase(p_stage, p_status) = 'unsure' THEN
      CASE coalesce(e.status, 'unknown')
        WHEN 'stable' THEN 0 WHEN 'in_treatment' THEN 0 WHEN 'unknown' THEN 5
        WHEN 'using' THEN 15 WHEN 'escalating' THEN 25 WHEN 'crisis' THEN 35
        ELSE 5
      END
    ELSE greatest(
      CASE public._invitation_recovery_phase(p_stage, p_status)
        WHEN 'active_use' THEN 15 WHEN 'return_to_use' THEN 15
        WHEN 'considering_treatment' THEN 10 WHEN 'returning_home' THEN 5
        WHEN 'in_treatment' THEN 0 WHEN 'early_recovery_30' THEN 0
        WHEN 'early_recovery_90' THEN 0 WHEN 'ongoing_recovery' THEN 0
        ELSE 5
      END,
      CASE e.status WHEN 'escalating' THEN 25 WHEN 'crisis' THEN 35 ELSE 0 END)
  END
  FROM (SELECT public._loved_one_effective_status(p_stage, p_status, p_stage_changed_at, p_status_changed_at,
                                                  p_recent_warnings, p_now) AS status) e
$$;

REVOKE ALL ON FUNCTION public._loved_one_effective_status(text, text, timestamptz, timestamptz, integer, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._loved_one_status_weight(text, text, timestamptz, timestamptz, integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._loved_one_effective_status(text, text, timestamptz, timestamptz, integer, timestamptz),
  public._loved_one_status_weight(text, text, timestamptz, timestamptz, integer, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.my_situation()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_account       uuid := public.my_account_id();
  v_low_days      int;
  v_avg_mood      numeric;
  v_warn          int;
  v_recov         int;
  v_net           int;
  v_loved         public.loved_ones%ROWTYPE;
  v_status        text;
  v_status_weight int;
  v_score         int;
  v_band          text;
  v_sustained     boolean;
  v_consequence_id uuid;
  v_consequence_type text;
  v_consequence_at timestamptz;
  v_window_ends_at timestamptz;
  v_window_active boolean := false;
BEGIN
  IF v_account IS NULL THEN
    RETURN jsonb_build_object(
      'score', 0, 'band', 'calm', 'sustained', false,
      'drivers', jsonb_build_object()
    );
  END IF;

  SELECT
    count(*) FILTER (WHERE mood <= 2),
    round(avg(mood)::numeric, 2)
  INTO v_low_days, v_avg_mood
  FROM public.checkins
  WHERE account_id = v_account
    AND created_at >= now() - interval '7 days';

  SELECT
    count(*) FILTER (WHERE kind = 'warning'),
    count(*) FILTER (WHERE kind = 'recovery')
  INTO v_warn, v_recov
  FROM public.tracker_logs
  WHERE account_id = v_account
    AND week >= (CURRENT_DATE - 14);

  v_low_days := coalesce(v_low_days, 0);
  v_warn     := coalesce(v_warn, 0);
  v_recov    := coalesce(v_recov, 0);
  v_net      := v_warn - v_recov;

  SELECT * INTO v_loved
  FROM public.loved_ones
  WHERE account_id = v_account;

  SELECT id, event_type, occurred_at
  INTO v_consequence_id, v_consequence_type, v_consequence_at
  FROM public.consequence_events
  WHERE account_id = v_account
  ORDER BY occurred_at DESC
  LIMIT 1;

  IF v_consequence_at IS NOT NULL THEN
    v_window_ends_at := v_consequence_at + interval '72 hours';
    v_window_active := v_consequence_at <= now() + interval '5 minutes'
      AND v_window_ends_at > now();
  END IF;

  -- Stage-aware, and an escalation that is no longer current stops counting.
  v_status := public._loved_one_effective_status(v_loved.stage, v_loved.status, v_loved.stage_changed_at,
    v_loved.status_changed_at, v_warn, now());
  v_status_weight := public._loved_one_status_weight(v_loved.stage, v_loved.status, v_loved.stage_changed_at,
    v_loved.status_changed_at, v_warn, now());

  -- A fresh concrete consequence changes posture immediately. It is an opening,
  -- not a guarantee; the client still shows emergency and spontaneous-help paths.
  v_score := (v_low_days * 10)
    + (greatest(v_net, 0) * 10)
    + v_status_weight
    + CASE WHEN v_window_active THEN 30 ELSE 0 END;

  v_band := CASE
    WHEN v_score >= 60 THEN 'crisis'
    WHEN v_score >= 30 THEN 'elevated'
    WHEN v_score >= 10 THEN 'watch'
    ELSE 'calm'
  END;

  v_sustained := (v_low_days >= 3 AND v_warn >= 3);

  RETURN jsonb_build_object(
    'score', v_score,
    'band', v_band,
    'sustained', v_sustained,
    'drivers', jsonb_build_object(
      'low_mood_days', v_low_days,
      'avg_mood', v_avg_mood,
      'warning_signs', v_warn,
      'recovery_signs', v_recov,
      'net_warnings', v_net,
      'loved_one_status', v_status,
      'loved_one_phase', CASE WHEN v_loved.stage IS NOT NULL
        THEN public._invitation_recovery_phase(v_loved.stage, v_loved.status) END,
      'latest_consequence_id', v_consequence_id,
      'latest_consequence_type', v_consequence_type,
      'latest_consequence_at', v_consequence_at,
      'willingness_window_ends_at', v_window_ends_at,
      'willingness_window_active', v_window_active
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.my_situation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_situation() TO authenticated;

-- Admin band distribution uses the same weights.
CREATE OR REPLACE FUNCTION public.admin_funnel_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
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
    )
  ) INTO v_result;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_funnel_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_funnel_stats() TO authenticated;
