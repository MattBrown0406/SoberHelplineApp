-- Harden legacy SECURITY DEFINER functions identified by Supabase advisors.
-- Fix search_path and remove PostgreSQL's default PUBLIC execute grant.

ALTER FUNCTION public.create_account_for_user() SET search_path = public, auth;
ALTER FUNCTION public.my_account_id() SET search_path = public, auth;
ALTER FUNCTION public.delete_own_account() SET search_path = public, auth;
ALTER FUNCTION public.is_family_member(uuid) SET search_path = public, auth;
ALTER FUNCTION public.redeem_invite_code(text) SET search_path = public, auth;

REVOKE EXECUTE ON FUNCTION public.create_account_for_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.my_account_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_own_account() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_family_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.redeem_invite_code(text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_account_for_user() TO service_role;
GRANT EXECUTE ON FUNCTION public.my_account_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_family_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.redeem_invite_code(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.redeem_invite_code(invite_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid;
  v_org_name text;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF invite_code IS NULL OR length(btrim(invite_code)) NOT BETWEEN 4 AND 64 THEN
    RETURN NULL;
  END IF;

  SELECT o.id, o.name INTO v_org_id, v_org_name
    FROM public.org_invite_codes c
    JOIN public.orgs o ON o.id = c.org_id
   WHERE c.code = upper(btrim(invite_code))
     AND c.active
     AND o.status = 'active';

  IF v_org_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.accounts
     SET type = 'attached', org_id = v_org_id
   WHERE user_id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_org_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.redeem_invite_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_invite_code(text) TO authenticated, service_role;
