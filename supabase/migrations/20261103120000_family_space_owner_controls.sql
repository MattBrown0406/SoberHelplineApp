-- A family space's invite code was permanent and nobody could be removed, so a
-- forwarded code let anyone (the loved one, an abusive partner) join for good
-- and read the family journal, shared boundaries and what members share. The
-- space's owner (family_spaces.created_by) can now remove a member and replace
-- the invite code. Removal does the same un-sharing as leave_family_space and
-- replaces the code too: every member can see it, so the removed person could
-- otherwise rejoin straight away.

-- New XXXX-XXXX (hex) code, same shape as the column default; retries on a collision.
CREATE OR REPLACE FUNCTION public._replace_family_invite_code(p_space uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
BEGIN
  LOOP
    v_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 4) || '-'
      || substring(replace(gen_random_uuid()::text, '-', ''), 1, 4));
    BEGIN
      UPDATE public.family_spaces SET invite_code = v_code WHERE id = p_space;
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      -- try another code
    END;
  END LOOP;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._replace_family_invite_code(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.remove_family_member(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := public.my_account_id();
  v_space uuid;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT fs.id INTO v_space
  FROM public.family_spaces fs
  JOIN public.family_members fm ON fm.family_space_id = fs.id AND fm.account_id = v_owner
  WHERE fs.created_by = v_owner;
  IF v_space IS NULL THEN
    RAISE EXCEPTION 'not_family_owner' USING ERRCODE = '42501';
  END IF;
  IF p_account_id IS NULL OR p_account_id = v_owner THEN
    RAISE EXCEPTION 'invalid_member' USING ERRCODE = '22023';
  END IF;
  -- Serialize with joins/leaves of this space.
  PERFORM 1 FROM public.family_spaces WHERE id = v_space FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.family_members WHERE family_space_id = v_space AND account_id = p_account_id) THEN
    -- Already gone (she left meanwhile): still replace the code, as promised.
    PERFORM public._replace_family_invite_code(v_space);
    RETURN;
  END IF;

  DELETE FROM public.wall_commitments wc
  USING public.shared_walls sw
  WHERE wc.shared_wall_id = sw.id AND sw.family_space_id = v_space AND wc.account_id = p_account_id;
  UPDATE public.wavering_events we
  SET shared_with_family = false
  FROM public.shared_walls sw
  WHERE we.shared_wall_id = sw.id AND sw.family_space_id = v_space AND we.account_id = p_account_id;
  UPDATE public.wall_hold_logs
  SET shared_with_family = false, family_space_id = NULL
  WHERE account_id = p_account_id AND family_space_id = v_space;
  DELETE FROM public.family_members WHERE family_space_id = v_space AND account_id = p_account_id;
  PERFORM public._replace_family_invite_code(v_space);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.remove_family_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_family_member(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.regenerate_family_invite_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid := public.my_account_id();
  v_space uuid;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT fs.id INTO v_space
  FROM public.family_spaces fs
  JOIN public.family_members fm ON fm.family_space_id = fs.id AND fm.account_id = v_owner
  WHERE fs.created_by = v_owner;
  IF v_space IS NULL THEN
    RAISE EXCEPTION 'not_family_owner' USING ERRCODE = '42501';
  END IF;
  RETURN public._replace_family_invite_code(v_space);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.regenerate_family_invite_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.regenerate_family_invite_code() TO authenticated;
