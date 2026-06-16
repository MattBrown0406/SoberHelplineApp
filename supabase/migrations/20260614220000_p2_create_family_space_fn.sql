-- Atomic helper: creates a family_space + owner member row in one call.
-- Runs as SECURITY DEFINER so it can insert both rows without the
-- client needing SELECT on the space before the member row exists.
-- Returns the new space's UUID.
CREATE OR REPLACE FUNCTION create_family_space(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_space_id   uuid;
BEGIN
  v_account_id := my_account_id();
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  v_space_id := gen_random_uuid();

  INSERT INTO family_spaces (id, name, created_by)
  VALUES (v_space_id, p_name, v_account_id);

  INSERT INTO family_members (family_space_id, account_id, role)
  VALUES (v_space_id, v_account_id, 'owner');

  RETURN v_space_id;
END;
$$;
