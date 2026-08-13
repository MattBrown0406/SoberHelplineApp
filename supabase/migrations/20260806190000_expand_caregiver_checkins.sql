-- Expand the daily check-in from mood-only to a private caregiver capacity
-- snapshot. Columns remain nullable so older installed app versions and
-- existing rows continue to work during rollout.

ALTER TABLE public.checkins
  ADD COLUMN IF NOT EXISTS capacity smallint,
  ADD COLUMN IF NOT EXISTS pressure smallint,
  ADD COLUMN IF NOT EXISTS support_need text;

ALTER TABLE public.checkins
  DROP CONSTRAINT IF EXISTS checkins_capacity_range,
  ADD CONSTRAINT checkins_capacity_range
    CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 5),
  DROP CONSTRAINT IF EXISTS checkins_pressure_range,
  ADD CONSTRAINT checkins_pressure_range
    CHECK (pressure IS NULL OR pressure BETWEEN 1 AND 5),
  DROP CONSTRAINT IF EXISTS checkins_support_need_allowed,
  ADD CONSTRAINT checkins_support_need_allowed
    CHECK (
      support_need IS NULL OR support_need IN (
        'rest', 'connection', 'boundary', 'plan', 'safety', 'steady'
      )
    );

COMMENT ON COLUMN public.checkins.capacity IS
  'Caregiver self-rated available capacity: 1 empty through 5 strong.';
COMMENT ON COLUMN public.checkins.pressure IS
  'Caregiver self-rated current pressure: 1 low through 5 overwhelming.';
COMMENT ON COLUMN public.checkins.support_need IS
  'Kind of support the caregiver says would help most today.';

-- Include the new fields only in the consent-previewed Situation Brief. The
-- member sees this exact snapshot before choosing whether to send it.
CREATE OR REPLACE FUNCTION build_situation_brief_sections(p_account uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mood      jsonb;
  v_tracker   jsonb;
  v_walls     jsonb;
  v_loved_one jsonb;
  v_rehearsal jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'day',          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
           'mood',         mood,
           'capacity',     capacity,
           'pressure',     pressure,
           'support_need', support_need,
           'note',         note
         ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_mood
  FROM (
    SELECT created_at, mood, capacity, pressure, support_need, note
    FROM checkins
    WHERE account_id = p_account
      AND created_at >= now() - interval '7 days'
    ORDER BY created_at DESC
    LIMIT 7
  ) c;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'sign_key', sign_key,
           'kind',     kind,
           'week',     to_char(week, 'YYYY-MM-DD')
         ) ORDER BY week DESC, sign_key), '[]'::jsonb)
  INTO v_tracker
  FROM (
    SELECT sign_key, kind, week
    FROM tracker_logs
    WHERE account_id = p_account
      AND week >= (CURRENT_DATE - 14)
    ORDER BY week DESC, sign_key
    LIMIT 40
  ) t;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'text',       text,
           'anchor',     anchor,
           'created_at', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
         ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_walls
  FROM (
    SELECT text, anchor, created_at
    FROM walls
    WHERE account_id = p_account
    ORDER BY created_at DESC
    LIMIT 8
  ) w;

  SELECT to_jsonb(lo) - 'id' - 'account_id' - 'created_at' - 'updated_at'
  INTO v_loved_one
  FROM loved_ones lo
  WHERE lo.account_id = p_account;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'created_at', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
           'scores',     debrief -> 'scores'
         ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_rehearsal
  FROM (
    SELECT created_at, debrief
    FROM rehearsal_sessions
    WHERE account_id = p_account
      AND debrief IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 3
  ) r;

  RETURN jsonb_build_object(
    'mood',         v_mood,
    'tracker',      v_tracker,
    'boundaries',   v_walls,
    'loved_one',    coalesce(v_loved_one, 'null'::jsonb),
    'rehearsal',    v_rehearsal,
    'generated_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION build_situation_brief_sections(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION build_situation_brief_sections(uuid) TO service_role;
