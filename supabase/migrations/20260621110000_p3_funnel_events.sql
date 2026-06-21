-- =============================================================================
-- P3.3 (follow-up) — Funnel event tracking
-- funnel_events logs the client-side funnel moments that no other table
-- captures: attending the free call, and intervention intent. Combined with
-- session_rsvps (RSVP) and coaching_bookings (coaching), this gives a complete
-- RSVP → attended → coaching → intervention funnel.
-- =============================================================================

CREATE TABLE funnel_events (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  stage      text        NOT NULL
               CHECK (stage IN ('rsvp', 'attended', 'coaching_requested',
                                'intervention_viewed', 'intervention_started')),
  metadata   jsonb       NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX funnel_events_stage_idx   ON funnel_events (stage, created_at DESC);
CREATE INDEX funnel_events_account_idx ON funnel_events (account_id, stage);

ALTER TABLE funnel_events ENABLE ROW LEVEL SECURITY;

-- Members read only their own events; admin reads all. Writes go through the
-- RPC below (SECURITY DEFINER) so account_id can't be spoofed.
CREATE POLICY "funnel_events: read own or admin" ON funnel_events FOR SELECT
  USING (
    account_id = my_account_id()
    OR (auth.jwt() ->> 'email') = 'matt@soberhelpline.com'
  );

CREATE OR REPLACE FUNCTION log_funnel_event(p_stage text, p_metadata jsonb DEFAULT '{}')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := my_account_id();
BEGIN
  IF v_account IS NULL THEN RETURN; END IF; -- pre-auth: no-op
  IF p_stage NOT IN ('rsvp', 'attended', 'coaching_requested',
                     'intervention_viewed', 'intervention_started') THEN
    RAISE EXCEPTION 'bad_stage';
  END IF;
  INSERT INTO funnel_events (account_id, stage, metadata)
  VALUES (v_account, p_stage, coalesce(p_metadata, '{}'));
END;
$$;

-- ─── Extend the admin funnel snapshot with the event-tracked stages ───────────
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
    'attended',            (SELECT count(DISTINCT account_id) FROM funnel_events
                              WHERE stage = 'attended'),
    'coaching_requested',  (SELECT count(DISTINCT account_id) FROM coaching_bookings),
    'coaching_confirmed',  (SELECT count(DISTINCT account_id) FROM coaching_bookings
                              WHERE status IN ('confirmed', 'completed')),
    'intervention_viewed',  (SELECT count(DISTINCT account_id) FROM funnel_events
                              WHERE stage = 'intervention_viewed'),
    'intervention_started', (SELECT count(DISTINCT account_id) FROM funnel_events
                              WHERE stage = 'intervention_started'),
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
