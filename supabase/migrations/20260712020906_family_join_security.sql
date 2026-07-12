-- Family membership is mutation-only through trusted SECURITY DEFINER flows.
-- create_family_space remains able to create its hard-coded owner row, while
-- invite joins can only create a hard-coded member row for the current account.

-- Remove every INSERT policy, including any policy added under a different name.
DO $do$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'family_members'
      AND cmd = 'INSERT'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.family_members', v_policy.policyname);
  END LOOP;
END
$do$;

REVOKE INSERT ON TABLE public.family_members FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.join_family_space(p_invite_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_account_id uuid;
  v_normalized_code text;
  v_space_id uuid;
BEGIN
  -- Do not rely on role membership alone: require a real Auth identity with a
  -- corresponding application account.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'not_authenticated';
  END IF;

  SELECT a.id
    INTO v_account_id
  FROM public.accounts AS a
  WHERE a.user_id = auth.uid();

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'account_not_found';
  END IF;

  v_normalized_code := upper(btrim(p_invite_code));
  IF v_normalized_code IS NULL
     OR v_normalized_code !~ '^[0-9A-F]{4}-[0-9A-F]{4}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_invite_code';
  END IF;

  SELECT fs.id
    INTO v_space_id
  FROM public.family_spaces AS fs
  WHERE fs.invite_code = v_normalized_code;

  IF v_space_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_invite_code';
  END IF;

  INSERT INTO public.family_members (family_space_id, account_id, role)
  VALUES (v_space_id, v_account_id, 'member')
  ON CONFLICT (family_space_id, account_id) DO NOTHING;

  RETURN v_space_id;
END;
$function$;

-- SECURITY DEFINER functions receive PUBLIC execute by default. Make the RPC an
-- explicit authenticated/service endpoint only.
REVOKE ALL ON FUNCTION public.join_family_space(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_family_space(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.join_family_space(text) TO authenticated, service_role;
