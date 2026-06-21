-- =============================================================================
-- P3.3 — Admin funnel analytics + family-health signals
-- admin_funnel_stats(): SECURITY DEFINER, admin-gated. Returns the funnel
-- counts (members → free-call RSVP → coaching requested → coaching confirmed)
-- and the readiness-band distribution across all members.
--
-- Band scoring is inlined here (and mirrors my_situation() in
-- 20260620120000_p0_loved_ones_and_situation.sql) because this aggregates across
-- all accounts in one pass rather than per-JWT. Keep the weights/thresholds in
-- sync with that function.
-- =============================================================================

CREATE OR REPLACE FUNCTION admin_funnel_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF (auth.jwt() ->> 'email') IS DISTINCT FROM 'matt@soberhelpline.com' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  WITH mood AS (
    SELECT account_id, count(*) FILTER (WHERE mood <= 2) AS low_days
    FROM checkins
    WHERE created_at >= now() - interval '7 days'
    GROUP BY account_id
  ),
  trk AS (
    SELECT account_id,
      count(*) FILTER (WHERE kind = 'warning')  AS warn,
      count(*) FILTER (WHERE kind = 'recovery') AS recov
    FROM tracker_logs
    WHERE week >= current_date - 14
    GROUP BY account_id
  ),
  scored AS (
    SELECT a.id,
      (coalesce(m.low_days, 0) * 10)
      + (greatest(coalesce(t.warn, 0) - coalesce(t.recov, 0), 0) * 10)
      + CASE coalesce(lo.status, 'unknown')
          WHEN 'stable' THEN 0
          WHEN 'in_treatment' THEN 0
          WHEN 'unknown' THEN 5
          WHEN 'using' THEN 15
          WHEN 'escalating' THEN 25
          WHEN 'crisis' THEN 35
          ELSE 5
        END AS score
    FROM accounts a
    LEFT JOIN mood m       ON m.account_id  = a.id
    LEFT JOIN trk  t       ON t.account_id  = a.id
    LEFT JOIN loved_ones lo ON lo.account_id = a.id
  )
  SELECT jsonb_build_object(
    'members',             (SELECT count(*) FROM accounts),
    'onboarded_loved_one', (SELECT count(*) FROM loved_ones),
    'free_rsvps',          (SELECT count(DISTINCT sr.account_id)
                              FROM session_rsvps sr
                              JOIN sessions s ON s.id = sr.session_id
                              WHERE s.kind = 'group' AND sr.status = 'going'),
    'coaching_requested',  (SELECT count(DISTINCT account_id) FROM coaching_bookings),
    'coaching_confirmed',  (SELECT count(DISTINCT account_id) FROM coaching_bookings
                              WHERE status IN ('confirmed', 'completed')),
    'bands', jsonb_build_object(
      'calm',     (SELECT count(*) FROM scored WHERE score < 10),
      'watch',    (SELECT count(*) FROM scored WHERE score >= 10 AND score < 30),
      'elevated', (SELECT count(*) FROM scored WHERE score >= 30 AND score < 60),
      'crisis',   (SELECT count(*) FROM scored WHERE score >= 60)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;
