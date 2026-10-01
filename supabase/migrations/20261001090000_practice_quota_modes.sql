-- =============================================================================
-- New metered AI modes: the practice whisper coach and Invitation Engine line
-- drafting. Same per-member daily caps model as reply/stt/debrief.
-- =============================================================================

ALTER TABLE public.rehearsal_usage DROP CONSTRAINT IF EXISTS rehearsal_usage_mode_check;
ALTER TABLE public.rehearsal_usage
  ADD CONSTRAINT rehearsal_usage_mode_check
  CHECK (mode IN ('reply', 'stt', 'debrief', 'whisper', 'invitation'));

CREATE OR REPLACE FUNCTION public.consume_rehearsal_quota(p_mode text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := public.my_account_id();
  v_limit   integer;
  v_count   integer;
BEGIN
  IF v_account IS NULL THEN
    RETURN false;
  END IF;

  v_limit := CASE p_mode
    WHEN 'reply'      THEN 200
    WHEN 'stt'        THEN 200
    WHEN 'debrief'    THEN 30
    WHEN 'whisper'    THEN 200
    WHEN 'invitation' THEN 30
    ELSE NULL
  END;
  IF v_limit IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.rehearsal_usage (account_id, usage_date, mode, count)
  VALUES (v_account, (now() AT TIME ZONE 'utc')::date, p_mode, 1)
  ON CONFLICT (account_id, usage_date, mode)
    DO UPDATE SET count = public.rehearsal_usage.count + 1
  RETURNING count INTO v_count;

  RETURN v_count <= v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_rehearsal_quota(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_rehearsal_quota(text) TO authenticated, service_role;
