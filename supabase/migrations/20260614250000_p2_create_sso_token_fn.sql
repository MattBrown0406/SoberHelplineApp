-- SECURITY DEFINER so the insert bypasses the RLS chicken-and-egg on web_sso_tokens.
-- Same pattern as create_family_space.
CREATE OR REPLACE FUNCTION create_web_sso_token()
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account_id uuid;
  v_token_id   uuid;
BEGIN
  v_account_id := my_account_id();
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  v_token_id := gen_random_uuid();
  INSERT INTO web_sso_tokens (id, account_id) VALUES (v_token_id, v_account_id);
  RETURN v_token_id;
END;
$$;
