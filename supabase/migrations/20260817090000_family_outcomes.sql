-- Account-owned, privacy-minimized family outcome evidence log.
-- Clients may read only their own rows and must use validated RPCs to mutate.

CREATE TABLE public.family_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  client_event_id uuid NOT NULL,
  event text NOT NULL CHECK (event IN (
    'entered_care', 'changed_level_of_care', 'completed_care',
    'left_care_early', 'returned_home', 'returned_to_use',
    'reengaged_in_care', 'other'
  )),
  occurred_on date NOT NULL,
  level_of_care text NOT NULL CHECK (level_of_care IN (
    'withdrawal_management', 'residential', 'partial_hospitalization',
    'intensive_outpatient', 'outpatient', 'recovery_residence',
    'hospital', 'other', 'unknown'
  )),
  pathway text NOT NULL CHECK (pathway IN (
    'self_initiated', 'family_boundary', 'planned_intervention',
    'professional_intervention', 'crisis_or_emergency', 'clinician_referral',
    'court_or_legal', 'provider_transfer', 'peer_or_recovery_support',
    'other', 'unknown'
  )),
  pathway_note text CHECK (pathway_note IS NULL OR length(pathway_note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT family_outcomes_account_client_event_unique UNIQUE (account_id, client_event_id)
);

CREATE INDEX family_outcomes_account_occurred_idx
  ON public.family_outcomes (account_id, occurred_on DESC, created_at DESC);

ALTER TABLE public.family_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "family_outcomes: own select"
  ON public.family_outcomes
  FOR SELECT
  TO authenticated
  USING (account_id = public.my_account_id());

REVOKE ALL ON TABLE public.family_outcomes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.family_outcomes TO authenticated;
GRANT ALL ON TABLE public.family_outcomes TO service_role;

CREATE OR REPLACE FUNCTION public.record_family_outcome(
  p_client_event_id uuid,
  p_event text,
  p_occurred_on date,
  p_level_of_care text,
  p_pathway text,
  p_pathway_note text DEFAULT NULL
)
RETURNS public.family_outcomes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_account_id uuid := public.my_account_id();
  v_note text := NULLIF(btrim(p_pathway_note), '');
  v_timezone text;
  v_today date;
  v_row public.family_outcomes;
BEGIN
  IF auth.uid() IS NULL OR v_account_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_client_event_id IS NULL THEN
    RAISE EXCEPTION 'invalid_client_event_id' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(
    (SELECT tz.name FROM pg_catalog.pg_timezone_names AS tz
      WHERE tz.name = NULLIF(a.timezone, '') LIMIT 1),
    'UTC'
  ) INTO v_timezone
  FROM public.accounts AS a
  WHERE a.id = v_account_id;
  v_today := (CURRENT_TIMESTAMP AT TIME ZONE v_timezone)::date;
  IF p_event IS NULL OR p_event NOT IN (
    'entered_care', 'changed_level_of_care', 'completed_care',
    'left_care_early', 'returned_home', 'returned_to_use',
    'reengaged_in_care', 'other'
  ) THEN
    RAISE EXCEPTION 'invalid_family_outcome_event' USING ERRCODE = '22023';
  END IF;
  IF p_occurred_on IS NULL OR p_occurred_on > v_today THEN
    RAISE EXCEPTION 'invalid_family_outcome_date' USING ERRCODE = '22023';
  END IF;
  IF p_level_of_care IS NULL OR p_level_of_care NOT IN (
    'withdrawal_management', 'residential', 'partial_hospitalization',
    'intensive_outpatient', 'outpatient', 'recovery_residence',
    'hospital', 'other', 'unknown'
  ) THEN
    RAISE EXCEPTION 'invalid_family_outcome_level' USING ERRCODE = '22023';
  END IF;
  IF p_pathway IS NULL OR p_pathway NOT IN (
    'self_initiated', 'family_boundary', 'planned_intervention',
    'professional_intervention', 'crisis_or_emergency', 'clinician_referral',
    'court_or_legal', 'provider_transfer', 'peer_or_recovery_support',
    'other', 'unknown'
  ) THEN
    RAISE EXCEPTION 'invalid_family_outcome_pathway' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN
    RAISE EXCEPTION 'family_outcome_note_too_long' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.family_outcomes (
    account_id, client_event_id, event, occurred_on,
    level_of_care, pathway, pathway_note
  ) VALUES (
    v_account_id, p_client_event_id, p_event, p_occurred_on,
    p_level_of_care, p_pathway, v_note
  )
  ON CONFLICT (account_id, client_event_id) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    SELECT * INTO v_row
    FROM public.family_outcomes AS fo
    WHERE fo.account_id = v_account_id
      AND fo.client_event_id = p_client_event_id;

    IF v_row.event IS DISTINCT FROM p_event
      OR v_row.occurred_on IS DISTINCT FROM p_occurred_on
      OR v_row.level_of_care IS DISTINCT FROM p_level_of_care
      OR v_row.pathway IS DISTINCT FROM p_pathway
      OR v_row.pathway_note IS DISTINCT FROM v_note
    THEN
      RAISE EXCEPTION 'family_outcome_client_event_conflict' USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_family_outcome(
  p_id uuid,
  p_event text,
  p_occurred_on date,
  p_level_of_care text,
  p_pathway text,
  p_pathway_note text DEFAULT NULL
)
RETURNS public.family_outcomes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_account_id uuid := public.my_account_id();
  v_note text := NULLIF(btrim(p_pathway_note), '');
  v_timezone text;
  v_today date;
  v_row public.family_outcomes;
BEGIN
  IF auth.uid() IS NULL OR v_account_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'invalid_family_outcome_id' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(
    (SELECT tz.name FROM pg_catalog.pg_timezone_names AS tz
      WHERE tz.name = NULLIF(a.timezone, '') LIMIT 1),
    'UTC'
  ) INTO v_timezone
  FROM public.accounts AS a
  WHERE a.id = v_account_id;
  v_today := (CURRENT_TIMESTAMP AT TIME ZONE v_timezone)::date;
  IF p_event IS NULL OR p_event NOT IN (
    'entered_care', 'changed_level_of_care', 'completed_care',
    'left_care_early', 'returned_home', 'returned_to_use',
    'reengaged_in_care', 'other'
  ) THEN
    RAISE EXCEPTION 'invalid_family_outcome_event' USING ERRCODE = '22023';
  END IF;
  IF p_occurred_on IS NULL OR p_occurred_on > v_today THEN
    RAISE EXCEPTION 'invalid_family_outcome_date' USING ERRCODE = '22023';
  END IF;
  IF p_level_of_care IS NULL OR p_level_of_care NOT IN (
    'withdrawal_management', 'residential', 'partial_hospitalization',
    'intensive_outpatient', 'outpatient', 'recovery_residence',
    'hospital', 'other', 'unknown'
  ) THEN
    RAISE EXCEPTION 'invalid_family_outcome_level' USING ERRCODE = '22023';
  END IF;
  IF p_pathway IS NULL OR p_pathway NOT IN (
    'self_initiated', 'family_boundary', 'planned_intervention',
    'professional_intervention', 'crisis_or_emergency', 'clinician_referral',
    'court_or_legal', 'provider_transfer', 'peer_or_recovery_support',
    'other', 'unknown'
  ) THEN
    RAISE EXCEPTION 'invalid_family_outcome_pathway' USING ERRCODE = '22023';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN
    RAISE EXCEPTION 'family_outcome_note_too_long' USING ERRCODE = '22023';
  END IF;

  UPDATE public.family_outcomes
  SET event = p_event,
      occurred_on = p_occurred_on,
      level_of_care = p_level_of_care,
      pathway = p_pathway,
      pathway_note = v_note,
      updated_at = now()
  WHERE id = p_id AND account_id = v_account_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'family_outcome_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_family_outcome(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_account_id uuid := public.my_account_id();
BEGIN
  IF auth.uid() IS NULL OR v_account_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'invalid_family_outcome_id' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.family_outcomes
  WHERE id = p_id AND account_id = v_account_id;
  -- Deletion is intentionally idempotent. A lost successful response can be
  -- retried safely, and returning true for an absent/non-owned UUID avoids
  -- leaking whether another account owns that identifier.
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_family_outcome_counts()
RETURNS TABLE(event text, level_of_care text, pathway text, outcome_count bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT fo.event, fo.level_of_care, fo.pathway, count(*)::bigint
  FROM public.family_outcomes AS fo
  GROUP BY fo.event, fo.level_of_care, fo.pathway
  ORDER BY fo.event, fo.level_of_care, fo.pathway;
END;
$$;

REVOKE ALL ON FUNCTION public.record_family_outcome(uuid, text, date, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_family_outcome(uuid, text, date, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_family_outcome(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_family_outcome_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_family_outcome(uuid, text, date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_family_outcome(uuid, text, date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_family_outcome(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_family_outcome_counts() TO authenticated;

COMMENT ON TABLE public.family_outcomes IS
  'Private account-owned family outcome events. Does not store loved-one names or diagnoses.';
COMMENT ON COLUMN public.family_outcomes.pathway_note IS
  'Optional bounded pathway context; excluded from all aggregate reporting.';
