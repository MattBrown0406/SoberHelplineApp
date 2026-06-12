-- =============================================================================
-- P0 push tokens + account self-deletion
-- push_token: stored for future server-side Expo push sends
-- delete_own_account(): SECURITY DEFINER so it can delete from auth.users
--   without requiring service role key in the client.
--   CASCADE removes accounts → checkins, walls, tracker_logs, consents.
-- =============================================================================

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS push_token text;

CREATE OR REPLACE FUNCTION delete_own_account()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;
