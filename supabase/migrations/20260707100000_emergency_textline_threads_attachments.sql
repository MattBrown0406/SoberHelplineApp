-- Emergency Text Line: paid in-app thread service with attachments and admin review.
-- AI response tables are deliberately dormant: no trigger/function calls them yet.

-- ─── Thread operational fields ───────────────────────────────────────────────
ALTER TABLE threads ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'escalated', 'closed'));
ALTER TABLE threads ADD COLUMN IF NOT EXISTS last_message_at timestamptz;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS last_member_message_at timestamptz;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS last_coach_message_at timestamptz;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS last_admin_read_at timestamptz;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS assigned_to uuid;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS ai_summary text;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS risk_level text NOT NULL DEFAULT 'normal'
  CHECK (risk_level IN ('normal', 'elevated', 'crisis'));

CREATE INDEX IF NOT EXISTS threads_active_last_message_idx
  ON threads (archived_at, kind, last_message_at DESC NULLS LAST);

-- ─── Sender roles for dormant AI/system messages ─────────────────────────────
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_sender_role_check;
ALTER TABLE messages ADD CONSTRAINT messages_sender_role_check
  CHECK (sender_role IN ('member', 'coach', 'ai', 'system'));

ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ─── Paid-tier access gate for the textline ──────────────────────────────────
CREATE OR REPLACE FUNCTION has_active_textline_access(p_account_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM accounts a
    WHERE a.id = p_account_id
      AND (
        a.type = 'attached'
        OR EXISTS (
          SELECT 1
          FROM entitlements e
          WHERE e.account_id = p_account_id
            AND e.tier IN ('essential', 'premium', 'org')
            AND (e.expires_at IS NULL OR e.expires_at > now())
        )
        OR (auth.jwt() ->> 'email') = 'matt@soberhelpline.com'
      )
  );
$$;

-- Replace thread/message policies so free direct accounts cannot create/use the
-- Emergency Text Line even if they deep-link to /chat.
DROP POLICY IF EXISTS "threads: owner insert" ON threads;
CREATE POLICY "threads: paid owner insert" ON threads FOR INSERT
  WITH CHECK (
    account_id = my_account_id()
    AND has_active_textline_access(account_id)
  );

DROP POLICY IF EXISTS "messages: thread owner insert as member" ON messages;
CREATE POLICY "messages: paid thread owner insert as member" ON messages FOR INSERT
  WITH CHECK (
    sender_role = 'member'
    AND thread_id IN (
      SELECT id FROM threads
      WHERE account_id = my_account_id()
        AND has_active_textline_access(account_id)
        AND archived_at IS NULL
    )
  );

-- Admin can review all threads/messages and reply as coach from the in-app admin.
DROP POLICY IF EXISTS "threads: admin select" ON threads;
CREATE POLICY "threads: admin select" ON threads FOR SELECT
  USING ((auth.jwt() ->> 'email') = 'matt@soberhelpline.com');

DROP POLICY IF EXISTS "threads: admin update" ON threads;
CREATE POLICY "threads: admin update" ON threads FOR UPDATE
  USING ((auth.jwt() ->> 'email') = 'matt@soberhelpline.com')
  WITH CHECK ((auth.jwt() ->> 'email') = 'matt@soberhelpline.com');

DROP POLICY IF EXISTS "messages: admin select" ON messages;
CREATE POLICY "messages: admin select" ON messages FOR SELECT
  USING ((auth.jwt() ->> 'email') = 'matt@soberhelpline.com');

DROP POLICY IF EXISTS "messages: admin insert as coach" ON messages;
CREATE POLICY "messages: admin insert as coach" ON messages FOR INSERT
  WITH CHECK (
    (auth.jwt() ->> 'email') = 'matt@soberhelpline.com'
    AND sender_role = 'coach'
  );

-- Maintain thread timestamps automatically.
CREATE OR REPLACE FUNCTION update_thread_message_rollup()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE threads
  SET
    last_message_at = NEW.created_at,
    last_member_message_at = CASE WHEN NEW.sender_role = 'member' THEN NEW.created_at ELSE last_member_message_at END,
    last_coach_message_at = CASE WHEN NEW.sender_role IN ('coach', 'ai') THEN NEW.created_at ELSE last_coach_message_at END
  WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_thread_message_rollup ON messages;
CREATE TRIGGER trg_update_thread_message_rollup
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION update_thread_message_rollup();

-- ─── Attachments ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  thread_id    uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  mime_type    text NOT NULL,
  file_name    text,
  width        integer,
  height       integer,
  size_bytes   integer,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (storage_path)
);

CREATE INDEX IF NOT EXISTS message_attachments_thread_idx
  ON message_attachments (thread_id, created_at);

ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attachments: thread owner select" ON message_attachments;
CREATE POLICY "attachments: thread owner select" ON message_attachments FOR SELECT
  USING (thread_id IN (SELECT id FROM threads WHERE account_id = my_account_id()));

DROP POLICY IF EXISTS "attachments: thread owner insert" ON message_attachments;
CREATE POLICY "attachments: thread owner insert" ON message_attachments FOR INSERT
  WITH CHECK (
    thread_id IN (
      SELECT id FROM threads
      WHERE account_id = my_account_id()
        AND has_active_textline_access(account_id)
        AND archived_at IS NULL
    )
    AND message_id IN (
      SELECT id FROM messages
      WHERE thread_id = message_attachments.thread_id
        AND sender_role = 'member'
    )
  );

DROP POLICY IF EXISTS "attachments: admin select" ON message_attachments;
CREATE POLICY "attachments: admin select" ON message_attachments FOR SELECT
  USING ((auth.jwt() ->> 'email') = 'matt@soberhelpline.com');

-- Private Supabase Storage bucket for screenshots / images.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments',
  'chat-attachments',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "chat attachments owner read" ON storage.objects;
CREATE POLICY "chat attachments owner read" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'chat-attachments'
    AND (
      (storage.foldername(name))[1] = my_account_id()::text
      OR (auth.jwt() ->> 'email') = 'matt@soberhelpline.com'
    )
  );

DROP POLICY IF EXISTS "chat attachments paid owner upload" ON storage.objects;
CREATE POLICY "chat attachments paid owner upload" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = my_account_id()::text
    AND has_active_textline_access(my_account_id())
  );

-- ─── Admin helpers ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_mark_thread_read(p_thread_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (auth.jwt() ->> 'email') IS DISTINCT FROM 'matt@soberhelpline.com' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE threads SET last_admin_read_at = now() WHERE id = p_thread_id;
END;
$$;

CREATE OR REPLACE FUNCTION admin_send_thread_message(p_thread_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message_id uuid;
BEGIN
  IF (auth.jwt() ->> 'email') IS DISTINCT FROM 'matt@soberhelpline.com' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  INSERT INTO messages (thread_id, sender_role, body)
  VALUES (p_thread_id, 'coach', trim(p_body))
  RETURNING id INTO v_message_id;

  UPDATE threads SET last_admin_read_at = now() WHERE id = p_thread_id;
  RETURN v_message_id;
END;
$$;

-- Upgrade existing admin inbox RPC with unread/status fields.
CREATE OR REPLACE FUNCTION admin_get_active_threads()
RETURNS TABLE(
  thread_id        uuid,
  first_name       text,
  last_name        text,
  last_message     text,
  last_message_at  timestamptz,
  message_count    bigint,
  unread_count     bigint,
  risk_level       text,
  status           text
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
    COALESCE(t.last_message_at, (SELECT created_at FROM messages WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1)),
    (SELECT count(*)   FROM messages WHERE thread_id = t.id),
    (SELECT count(*)   FROM messages
      WHERE thread_id = t.id
        AND sender_role = 'member'
        AND (t.last_admin_read_at IS NULL OR created_at > t.last_admin_read_at)),
    t.risk_level,
    t.status
  FROM threads  t
  JOIN accounts a ON a.id = t.account_id
  WHERE t.archived_at IS NULL
    AND t.kind = 'oncall'
  ORDER BY COALESCE(t.last_message_at, (SELECT created_at FROM messages WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1)) DESC NULLS LAST
  LIMIT 100;
$$;

-- ─── Dormant future AI response scaffolding ──────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_response_drafts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id    uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  message_id   uuid REFERENCES messages(id) ON DELETE SET NULL,
  draft_body   text NOT NULL,
  risk_level   text NOT NULL DEFAULT 'normal' CHECK (risk_level IN ('normal', 'elevated', 'crisis')),
  model        text,
  prompt_version text,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'discarded')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_at  timestamptz
);

ALTER TABLE ai_response_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai drafts: admin select" ON ai_response_drafts;
CREATE POLICY "ai drafts: admin select" ON ai_response_drafts FOR SELECT
  USING ((auth.jwt() ->> 'email') = 'matt@soberhelpline.com');

COMMENT ON TABLE ai_response_drafts IS 'Dormant future AI response engine output. No trigger currently creates or sends these drafts.';
