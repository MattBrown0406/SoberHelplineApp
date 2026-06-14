-- join_family_space: SECURITY DEFINER so non-members can look up a space by
-- invite code (family_spaces RLS only lets members SELECT their own spaces).
-- Inserts the caller as a member and returns the space id, or NULL on bad code.
CREATE OR REPLACE FUNCTION join_family_space(p_invite_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_space_id uuid;
BEGIN
  SELECT id INTO v_space_id
  FROM family_spaces
  WHERE invite_code = upper(trim(p_invite_code));

  IF v_space_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO family_members (family_space_id, account_id, role)
  VALUES (v_space_id, my_account_id(), 'member')
  ON CONFLICT (family_space_id, account_id) DO NOTHING;

  RETURN v_space_id;
END;
$$;
