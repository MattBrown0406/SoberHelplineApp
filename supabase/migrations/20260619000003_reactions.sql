-- Clear all existing messages (test data cleanup)
TRUNCATE messages CASCADE;

-- Message reactions
CREATE TABLE IF NOT EXISTS message_reactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reaction    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, account_id, reaction)
);

-- Full replica identity so DELETE events include all columns in Realtime
ALTER TABLE message_reactions REPLICA IDENTITY FULL;

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

-- Members and admin can read reactions on their thread's messages
CREATE POLICY "read_thread_reactions" ON message_reactions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM messages m
    JOIN threads t ON t.id = m.thread_id
    WHERE m.id = message_reactions.message_id
      AND (
        t.account_id = (SELECT id FROM accounts WHERE user_id = auth.uid())
        OR (auth.jwt() ->> 'email') = 'matt@soberhelpline.com'
      )
  )
);

-- Members can manage only their own reactions
CREATE POLICY "own_reactions" ON message_reactions
  FOR ALL
  USING (account_id = (SELECT id FROM accounts WHERE user_id = auth.uid()))
  WITH CHECK (account_id = (SELECT id FROM accounts WHERE user_id = auth.uid()));

-- Toggle a reaction on/off
CREATE OR REPLACE FUNCTION toggle_reaction(p_message_id uuid, p_reaction text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  SELECT id INTO v_account_id FROM accounts WHERE user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'no_account'; END IF;

  IF EXISTS (
    SELECT 1 FROM message_reactions
    WHERE message_id = p_message_id
      AND account_id = v_account_id
      AND reaction   = p_reaction
  ) THEN
    DELETE FROM message_reactions
    WHERE message_id = p_message_id
      AND account_id = v_account_id
      AND reaction   = p_reaction;
  ELSE
    INSERT INTO message_reactions (message_id, account_id, reaction)
    VALUES (p_message_id, v_account_id, p_reaction);
  END IF;
END;
$$;
