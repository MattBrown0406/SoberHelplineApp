-- Persist only explicit signup legal consent captured in auth metadata.
-- No client-supplied account/version/time parameters are trusted.
CREATE OR REPLACE FUNCTION public.record_signup_terms_consent()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_metadata jsonb;
  v_version text;
  v_accepted_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT a.id, coalesce(u.raw_user_meta_data, '{}'::jsonb)
  INTO v_account_id, v_metadata
  FROM public.accounts a
  JOIN auth.users u ON u.id = a.user_id
  WHERE a.user_id = auth.uid();

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_version := nullif(v_metadata ->> 'terms_version', '');
  IF v_version IS NULL OR v_metadata ->> 'terms_accepted_at' IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    v_accepted_at := (v_metadata ->> 'terms_accepted_at')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RETURN false;
  END;

  IF v_accepted_at > now() + interval '5 minutes' THEN
    RETURN false;
  END IF;

  INSERT INTO public.consents(account_id, consent_key, version, granted_at)
  VALUES (v_account_id, '1', v_version, v_accepted_at)
  ON CONFLICT (account_id, consent_key) DO NOTHING;

  RETURN EXISTS (
    SELECT 1 FROM public.consents
    WHERE account_id = v_account_id
      AND consent_key = '1'
      AND revoked_at IS NULL
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_signup_terms_consent() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_signup_terms_consent() TO authenticated;
