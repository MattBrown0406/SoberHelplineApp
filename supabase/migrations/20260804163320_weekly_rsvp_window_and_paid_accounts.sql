-- Reset Family Squares RSVPs every Tuesday at 2:00 AM America/Los_Angeles
-- and expose an active paid-account count to the admin funnel snapshot.

CREATE OR REPLACE FUNCTION public.reset_family_squares_weekly_rsvps()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local_now timestamp := clock_timestamp() AT TIME ZONE 'America/Los_Angeles';
  v_deleted integer := 0;
BEGIN
  -- pg_cron runs in UTC. The job runs at both possible UTC offsets and this
  -- guard makes exactly the 2 AM Pacific invocation perform the reset.
  IF extract(isodow FROM v_local_now) <> 2 OR extract(hour FROM v_local_now) <> 2 THEN
    RETURN 0;
  END IF;

  DELETE FROM public.session_rsvps
  WHERE session_id = public.family_squares_session_id();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reset_family_squares_weekly_rsvps() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_family_squares_weekly_rsvps() TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'reset-family-squares-rsvps-tuesday-2am-pacific';
SELECT cron.schedule(
  'reset-family-squares-rsvps-tuesday-2am-pacific',
  '0 9,10 * * 2',
  'SELECT public.reset_family_squares_weekly_rsvps();'
);

CREATE OR REPLACE FUNCTION public.admin_funnel_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
      + CASE coalesce(lo.status, 'unknown')
          WHEN 'stable' THEN 0 WHEN 'in_treatment' THEN 0 WHEN 'unknown' THEN 5
          WHEN 'using' THEN 15 WHEN 'escalating' THEN 25 WHEN 'crisis' THEN 35
          ELSE 5
        END AS score
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
$$;

REVOKE EXECUTE ON FUNCTION public.admin_funnel_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_funnel_stats() TO authenticated;
