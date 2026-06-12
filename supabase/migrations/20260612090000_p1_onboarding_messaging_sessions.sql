-- =============================================================================
-- P1: org invite codes + redemption, coach messaging threads, sessions + RSVPs
-- =============================================================================

-- ─── Org invite codes ─────────────────────────────────────────────────────────
CREATE TABLE org_invite_codes (
  code       text        PRIMARY KEY,
  org_id     uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE org_invite_codes ENABLE ROW LEVEL SECURITY;
-- No client policies: redemption goes through the SECURITY DEFINER function.

-- Attaches the calling account to the org for a valid code.
-- Returns the org name on success, NULL for an invalid/inactive code.
CREATE OR REPLACE FUNCTION redeem_invite_code(invite_code text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_org_id uuid;
  v_org_name text;
BEGIN
  SELECT o.id, o.name INTO v_org_id, v_org_name
  FROM org_invite_codes c JOIN orgs o ON o.id = c.org_id
  WHERE c.code = upper(trim(invite_code)) AND c.active AND o.status = 'active';

  IF v_org_id IS NULL THEN RETURN NULL; END IF;

  UPDATE accounts SET type = 'attached', org_id = v_org_id
  WHERE user_id = auth.uid();

  RETURN v_org_name;
END;
$$;

-- ─── Messaging threads ────────────────────────────────────────────────────────
CREATE TABLE threads (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind       text        NOT NULL DEFAULT 'oncall' CHECK (kind IN ('assigned', 'oncall')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, kind)
);

CREATE TABLE messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   uuid        NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  sender_role text        NOT NULL CHECK (sender_role IN ('member', 'coach')),
  body        text        NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_thread_created ON messages (thread_id, created_at);

ALTER TABLE threads  ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "threads: owner select" ON threads FOR SELECT
  USING (account_id = my_account_id());
CREATE POLICY "threads: owner insert" ON threads FOR INSERT
  WITH CHECK (account_id = my_account_id());

CREATE POLICY "messages: thread owner select" ON messages FOR SELECT
  USING (thread_id IN (SELECT id FROM threads WHERE account_id = my_account_id()));
-- Members may only write as themselves; coach replies arrive via service role (P1 web dashboard).
CREATE POLICY "messages: thread owner insert as member" ON messages FOR INSERT
  WITH CHECK (
    sender_role = 'member'
    AND thread_id IN (SELECT id FROM threads WHERE account_id = my_account_id())
  );

-- Realtime: clients subscribe to new messages on their thread.
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- ─── Sessions + RSVPs ─────────────────────────────────────────────────────────
CREATE TABLE sessions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        REFERENCES orgs(id) ON DELETE CASCADE,  -- NULL = platform-wide
  kind         text        NOT NULL DEFAULT 'group' CHECK (kind IN ('group', 'one-on-one', 'family')),
  title        text        NOT NULL,
  schedule_label text      NOT NULL,            -- human label, localized later
  next_at      timestamptz,
  zoom_url     text,
  visibility   text        NOT NULL DEFAULT 'all' CHECK (visibility IN ('all', 'org', 'invite')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE session_rsvps (
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'going' CHECK (status IN ('going', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, account_id)
);

ALTER TABLE sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_rsvps ENABLE ROW LEVEL SECURITY;

-- Platform-wide sessions visible to all members; org sessions to that org's members.
CREATE POLICY "sessions: visible" ON sessions FOR SELECT
  USING (
    visibility = 'all'
    OR (visibility = 'org' AND org_id IN
        (SELECT org_id FROM accounts WHERE user_id = auth.uid()))
  );

CREATE POLICY "session_rsvps: owner all" ON session_rsvps FOR ALL
  USING     (account_id = my_account_id())
  WITH CHECK (account_id = my_account_id());

-- ─── Seeds: Freedom Interventions org, demo invite code, platform sessions ────
INSERT INTO orgs (id, name) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Freedom Interventions')
ON CONFLICT DO NOTHING;

INSERT INTO org_invite_codes (code, org_id) VALUES
  ('FREEDOM2026', 'a0000000-0000-0000-0000-000000000001')
ON CONFLICT DO NOTHING;

INSERT INTO sessions (kind, title, schedule_label, next_at, visibility) VALUES
  ('group', 'Monday Night Family Support', 'Mondays · 7:00 PM PT · Zoom',
    (date_trunc('week', now()) + interval '7 hours' * 43), 'all'),
  ('group', 'First 90 Days After Intervention', 'Drop-in · Daily · Zoom',
    now() + interval '1 day', 'all'),
  ('group', 'Familias en Recuperación', 'Jueves · 6:00 PM PT · Zoom',
    now() + interval '3 days', 'all')
ON CONFLICT DO NOTHING;
