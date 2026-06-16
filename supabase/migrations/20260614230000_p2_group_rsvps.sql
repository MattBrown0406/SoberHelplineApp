-- Group RSVP: users subscribe to be notified when a group goes live.

CREATE TABLE group_rsvps (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  room_name  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, room_name)
);

ALTER TABLE group_rsvps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_group_rsvps" ON group_rsvps
  FOR ALL USING (account_id = my_account_id());

-- SECURITY DEFINER so the edge function can call this without exposing auth schema.
CREATE OR REPLACE FUNCTION get_group_rsvp_push_tokens(p_room_name text)
RETURNS TABLE(push_token text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT a.push_token
  FROM group_rsvps gr
  JOIN accounts a ON a.id = gr.account_id
  WHERE gr.room_name = p_room_name
    AND a.push_token IS NOT NULL;
$$;
