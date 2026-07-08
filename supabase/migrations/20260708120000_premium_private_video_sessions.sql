-- Premium Private Video Support: 1:1 interactive LiveKit rooms.
-- Keeps existing group/live broadcast behavior separate from private premium sessions.

CREATE TABLE IF NOT EXISTS video_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  room_name     text NOT NULL UNIQUE,
  status        text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'scheduled', 'live', 'completed', 'cancelled')),
  scheduled_for timestamptz,
  started_at    timestamptz,
  ended_at      timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS video_sessions_account_status_idx
  ON video_sessions (account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS video_sessions_status_created_idx
  ON video_sessions (status, created_at DESC);

ALTER TABLE video_sessions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION has_active_private_video_access(p_account_id uuid)
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
            AND e.tier IN ('premium', 'org')
            AND (e.expires_at IS NULL OR e.expires_at > now())
        )
        OR lower(auth.jwt() ->> 'email') = 'matt@soberhelpline.com'
      )
  );
$$;

DROP POLICY IF EXISTS "video sessions: owner/admin select" ON video_sessions;
CREATE POLICY "video sessions: owner/admin select" ON video_sessions FOR SELECT
  USING (
    account_id = my_account_id()
    OR lower(auth.jwt() ->> 'email') = 'matt@soberhelpline.com'
  );

DROP POLICY IF EXISTS "video sessions: owner request" ON video_sessions;
CREATE POLICY "video sessions: owner request" ON video_sessions FOR INSERT
  WITH CHECK (
    account_id = my_account_id()
    AND has_active_private_video_access(account_id)
  );

DROP POLICY IF EXISTS "video sessions: admin update" ON video_sessions;
CREATE POLICY "video sessions: admin update" ON video_sessions FOR UPDATE
  USING (lower(auth.jwt() ->> 'email') = 'matt@soberhelpline.com')
  WITH CHECK (lower(auth.jwt() ->> 'email') = 'matt@soberhelpline.com');

CREATE OR REPLACE FUNCTION set_video_session_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  IF NEW.status = 'live' AND OLD.status IS DISTINCT FROM 'live' AND NEW.started_at IS NULL THEN
    NEW.started_at = now();
  END IF;
  IF NEW.status IN ('completed', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status AND NEW.ended_at IS NULL THEN
    NEW.ended_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_video_sessions_updated_at ON video_sessions;
CREATE TRIGGER trg_video_sessions_updated_at
  BEFORE UPDATE ON video_sessions
  FOR EACH ROW EXECUTE FUNCTION set_video_session_updated_at();

CREATE OR REPLACE FUNCTION request_private_video_session()
RETURNS video_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_existing video_sessions;
  v_new video_sessions;
BEGIN
  v_account_id := my_account_id();
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NOT has_active_private_video_access(v_account_id) THEN
    RAISE EXCEPTION 'premium video access required';
  END IF;

  SELECT * INTO v_existing
  FROM video_sessions
  WHERE account_id = v_account_id
    AND status IN ('requested', 'scheduled', 'live')
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  INSERT INTO video_sessions (account_id, room_name, status)
  VALUES (v_account_id, 'premium-video-' || gen_random_uuid()::text, 'requested')
  RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION admin_get_video_sessions()
RETURNS TABLE(
  id uuid,
  account_id uuid,
  room_name text,
  status text,
  scheduled_for timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  first_name text,
  last_name text,
  email text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    vs.id,
    vs.account_id,
    vs.room_name,
    vs.status,
    vs.scheduled_for,
    vs.started_at,
    vs.ended_at,
    vs.created_at,
    vs.updated_at,
    a.first_name,
    a.last_name,
    u.email::text
  FROM video_sessions vs
  JOIN accounts a ON a.id = vs.account_id
  LEFT JOIN auth.users u ON u.id = a.user_id
  WHERE lower(auth.jwt() ->> 'email') = 'matt@soberhelpline.com'
  ORDER BY
    CASE vs.status
      WHEN 'live' THEN 1
      WHEN 'requested' THEN 2
      WHEN 'scheduled' THEN 3
      WHEN 'completed' THEN 4
      ELSE 5
    END,
    COALESCE(vs.scheduled_for, vs.created_at) DESC
  LIMIT 100;
$$;

CREATE OR REPLACE FUNCTION admin_update_video_session(
  p_session_id uuid,
  p_status text DEFAULT NULL,
  p_scheduled_for timestamptz DEFAULT NULL
)
RETURNS video_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated video_sessions;
BEGIN
  IF lower(auth.jwt() ->> 'email') IS DISTINCT FROM 'matt@soberhelpline.com' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('requested', 'scheduled', 'live', 'completed', 'cancelled') THEN
    RAISE EXCEPTION 'invalid status';
  END IF;

  UPDATE video_sessions
  SET
    status = COALESCE(p_status, status),
    scheduled_for = COALESCE(p_scheduled_for, scheduled_for)
  WHERE id = p_session_id
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'video session not found';
  END IF;

  RETURN v_updated;
END;
$$;
