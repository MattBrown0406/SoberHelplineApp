-- =============================================================================
-- P2 supplement: add is_live flag to group_hosts so clients can show
-- "Join Live" on group rows when a host is broadcasting.
-- =============================================================================

ALTER TABLE group_hosts
  ADD COLUMN IF NOT EXISTS is_live boolean NOT NULL DEFAULT false;

-- SECURITY DEFINER so any authenticated host can flip their own flag
-- without exposing a broad UPDATE policy.
CREATE OR REPLACE FUNCTION set_host_live(p_room_name text, p_is_live boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE group_hosts
  SET    is_live = p_is_live
  WHERE  room_name  = p_room_name
    AND  account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid());
$$;
