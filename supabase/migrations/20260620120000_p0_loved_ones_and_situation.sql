-- =============================================================================
-- P0 — Loved ones + situation scoring
-- Table:   loved_ones (one per account, RLS owner-only via my_account_id())
-- RPC:     my_situation() SECURITY DEFINER → {score, band, sustained, drivers}
-- Scoring: low-mood days (checkins, 7d) + net warning signs (tracker_logs, 14d)
--          + loved_ones.status weight. Bands: calm/watch/elevated/crisis.
--          sustained = ≥3 low-mood days AND ≥3 warning signs.
-- =============================================================================

-- ─── Loved ones ───────────────────────────────────────────────────────────────
-- The person the family member is worried about. One row per account; save()
-- upserts on account_id. status drives the situation score and is updated by the
-- crisis/tracker off-ramps (P1) via set_loved_one_status().
CREATE TABLE IF NOT EXISTS loved_ones (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid        NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  relationship text,        -- son | daughter | spouse | partner | parent | sibling | friend | other
  first_name   text,
  substances   text[]       NOT NULL DEFAULT '{}',  -- alcohol | opioids | stimulants | …
  stage        text,        -- using | seeking_help | in_treatment | recovery | unsure
  status       text        NOT NULL DEFAULT 'unknown'
                 CHECK (status IN ('stable','in_treatment','unknown','using','escalating','crisis')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE loved_ones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "loved_ones: owner all"
  ON loved_ones FOR ALL
  USING     (account_id = my_account_id())
  WITH CHECK (account_id = my_account_id());

-- Convenience RPC for the off-ramps to bump status without re-sending the whole
-- record. Owner-scoped (no account_id parameter — resolved from the JWT).
CREATE OR REPLACE FUNCTION set_loved_one_status(p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := my_account_id();
BEGIN
  IF v_account IS NULL THEN RAISE EXCEPTION 'no_account'; END IF;

  INSERT INTO loved_ones (account_id, status, updated_at)
  VALUES (v_account, p_status, now())
  ON CONFLICT (account_id)
  DO UPDATE SET status = EXCLUDED.status, updated_at = now();
END;
$$;

-- ─── Situation scoring ────────────────────────────────────────────────────────
-- Returns the family's current readiness band and the raw drivers behind it so
-- the client can bias content and pick the right funnel door. SECURITY DEFINER
-- so it can aggregate the caller's own rows; account is resolved from the JWT.
CREATE OR REPLACE FUNCTION my_situation()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account       uuid := my_account_id();
  v_low_days      int;
  v_avg_mood      numeric;
  v_warn          int;
  v_recov         int;
  v_net           int;
  v_status        text;
  v_status_weight int;
  v_score         int;
  v_band          text;
  v_sustained     boolean;
BEGIN
  IF v_account IS NULL THEN
    RETURN jsonb_build_object(
      'score', 0, 'band', 'calm', 'sustained', false,
      'drivers', jsonb_build_object()
    );
  END IF;

  -- Mood: low days (mood ≤ 2) and 7-day average.
  SELECT
    count(*) FILTER (WHERE mood <= 2),
    round(avg(mood)::numeric, 2)
  INTO v_low_days, v_avg_mood
  FROM checkins
  WHERE account_id = v_account
    AND created_at >= now() - interval '7 days';

  -- Tracker: warning vs recovery signs over the recent two weeks.
  SELECT
    count(*) FILTER (WHERE kind = 'warning'),
    count(*) FILTER (WHERE kind = 'recovery')
  INTO v_warn, v_recov
  FROM tracker_logs
  WHERE account_id = v_account
    AND week >= (CURRENT_DATE - 14);

  v_low_days := coalesce(v_low_days, 0);
  v_warn     := coalesce(v_warn, 0);
  v_recov    := coalesce(v_recov, 0);
  v_net      := v_warn - v_recov;

  SELECT status INTO v_status
  FROM loved_ones
  WHERE account_id = v_account;

  v_status_weight := CASE coalesce(v_status, 'unknown')
    WHEN 'stable'       THEN 0
    WHEN 'in_treatment' THEN 0
    WHEN 'unknown'      THEN 5
    WHEN 'using'        THEN 15
    WHEN 'escalating'   THEN 25
    WHEN 'crisis'       THEN 35
    ELSE 5
  END;

  -- Weighted score: mood weighs heaviest, then net warning signs, then status.
  v_score := (v_low_days * 8) + (greatest(v_net, 0) * 6) + v_status_weight;

  v_band := CASE
    WHEN v_score >= 60 THEN 'crisis'
    WHEN v_score >= 35 THEN 'elevated'
    WHEN v_score >= 15 THEN 'watch'
    ELSE 'calm'
  END;

  v_sustained := (v_low_days >= 3 AND v_warn >= 3);

  RETURN jsonb_build_object(
    'score',     v_score,
    'band',      v_band,
    'sustained', v_sustained,
    'drivers',   jsonb_build_object(
      'low_mood_days',    v_low_days,
      'avg_mood',         v_avg_mood,
      'warning_signs',    v_warn,
      'recovery_signs',   v_recov,
      'net_warnings',     v_net,
      'loved_one_status', v_status
    )
  );
END;
$$;
