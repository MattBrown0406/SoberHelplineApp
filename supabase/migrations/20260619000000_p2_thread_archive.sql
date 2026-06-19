-- Allow threads to be archived so either party can start a fresh conversation.

ALTER TABLE threads ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Member archives their own thread; admin archives any thread.
CREATE OR REPLACE FUNCTION archive_thread(p_thread_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (auth.jwt() ->> 'email') = 'matt@soberhelpline.com' THEN
    UPDATE threads SET archived_at = now() WHERE id = p_thread_id;
  ELSE
    UPDATE threads
    SET archived_at = now()
    WHERE id = p_thread_id
      AND account_id = my_account_id();
  END IF;
END;
$$;

-- Admin view: active (non-archived) oncall threads with last message preview.
CREATE OR REPLACE FUNCTION admin_get_active_threads()
RETURNS TABLE(
  thread_id        uuid,
  first_name       text,
  last_name        text,
  last_message     text,
  last_message_at  timestamptz,
  message_count    bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    a.first_name,
    a.last_name,
    (SELECT body       FROM messages WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1),
    (SELECT created_at FROM messages WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1),
    (SELECT count(*)   FROM messages WHERE thread_id = t.id)
  FROM threads  t
  JOIN accounts a ON a.id = t.account_id
  WHERE t.archived_at IS NULL
    AND t.kind = 'oncall'
  ORDER BY (SELECT created_at FROM messages WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1) DESC NULLS LAST
  LIMIT 100;
$$;
