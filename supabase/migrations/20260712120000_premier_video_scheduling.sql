-- Premier private-video scheduling workflow.
-- Extends video_sessions without deleting existing rows and replaces direct table
-- mutation with versioned, role-checked RPCs.

-- Staff authorization is database-owned. Matt remains the bootstrap owner; adding
-- a coach requires inserting an account here (normally by service_role/owner).
CREATE TABLE video_staff_roles (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'coach')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO video_staff_roles (account_id, role)
SELECT a.id, 'owner'
FROM accounts a JOIN auth.users u ON u.id = a.user_id
WHERE lower(u.email) = 'matt@soberhelpline.com'
ON CONFLICT (account_id) DO UPDATE SET role = 'owner', active = true, updated_at = now();

ALTER TABLE video_sessions
  ADD COLUMN requested_start timestamptz,
  ADD COLUMN requested_timezone text,
  ADD COLUMN duration_minutes integer,
  ADD COLUMN member_note text,
  ADD COLUMN assigned_coach_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN cancelled_at timestamptz,
  ADD COLUMN cancelled_by_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN cancellation_reason text,
  ADD COLUMN completion_outcome text,
  ADD COLUMN calendar_event_id text,
  ADD COLUMN calendar_sync_status text NOT NULL DEFAULT 'not_synced',
  ADD COLUMN calendar_sync_error text,
  ADD COLUMN calendar_synced_at timestamptz;

-- Preserve legacy requests while making every row structurally usable. New RPC
-- requests enforce exact values; legacy NULL start times are represented by their
-- creation time and account timezone where available.
UPDATE video_sessions vs
SET requested_start = COALESCE(vs.requested_start, vs.scheduled_for, vs.created_at),
    requested_timezone = COALESCE(vs.requested_timezone, NULLIF(a.timezone, ''), 'UTC'),
    duration_minutes = COALESCE(vs.duration_minutes, 60)
FROM accounts a
WHERE a.id = vs.account_id
  AND (vs.requested_start IS NULL OR vs.requested_timezone IS NULL OR vs.duration_minutes IS NULL);

ALTER TABLE video_sessions
  ALTER COLUMN requested_start SET NOT NULL,
  ALTER COLUMN requested_timezone SET NOT NULL,
  ALTER COLUMN duration_minutes SET NOT NULL,
  ADD CONSTRAINT video_sessions_duration_check CHECK (duration_minutes BETWEEN 15 AND 240),
  ADD CONSTRAINT video_sessions_timezone_check CHECK (length(requested_timezone) BETWEEN 1 AND 100),
  ADD CONSTRAINT video_sessions_note_check CHECK (member_note IS NULL OR length(member_note) <= 2000),
  ADD CONSTRAINT video_sessions_outcome_check CHECK (completion_outcome IS NULL OR completion_outcome IN ('completed','member_no_show','coach_no_show')),
  ADD CONSTRAINT video_sessions_calendar_sync_check CHECK (calendar_sync_status IN ('not_synced','pending','synced','failed','cancelled'));

ALTER TABLE video_sessions DROP CONSTRAINT IF EXISTS video_sessions_status_check;
ALTER TABLE video_sessions ADD CONSTRAINT video_sessions_status_check
  CHECK (status IN ('requested', 'scheduled', 'live', 'completed', 'cancelled', 'no_show'));

-- If old data somehow contains duplicate active rows, retain the newest active row
-- and archive/cancel older ones before installing the invariant.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY account_id ORDER BY created_at DESC, id DESC) AS rn
  FROM video_sessions WHERE status IN ('requested', 'scheduled', 'live')
)
UPDATE video_sessions vs
SET status = 'cancelled', cancelled_at = now(), ended_at = COALESCE(ended_at, now()),
    archived_at = now(), cancellation_reason = 'legacy_duplicate_migrated', version = version + 1
FROM ranked r WHERE vs.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX video_sessions_one_active_member_idx
  ON video_sessions(account_id) WHERE status IN ('requested', 'scheduled', 'live');
CREATE INDEX video_sessions_coach_schedule_idx
  ON video_sessions(assigned_coach_id, scheduled_for)
  WHERE status IN ('scheduled', 'live');
CREATE INDEX video_sessions_history_idx
  ON video_sessions(account_id, COALESCE(ended_at, cancelled_at, updated_at) DESC, id DESC)
  WHERE status IN ('completed', 'cancelled', 'no_show');

CREATE TABLE video_session_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES video_sessions(id) ON DELETE CASCADE,
  proposed_by_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  proposed_by_role text NOT NULL CHECK (proposed_by_role IN ('member', 'coach')),
  coach_id uuid REFERENCES accounts(id) ON DELETE RESTRICT,
  starts_at timestamptz NOT NULL,
  timezone text NOT NULL CHECK (length(timezone) BETWEEN 1 AND 100),
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 15 AND 240),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz
);
CREATE UNIQUE INDEX video_session_one_pending_proposal_idx
  ON video_session_proposals(session_id) WHERE status = 'pending';
CREATE INDEX video_session_proposals_session_idx ON video_session_proposals(session_id, created_at DESC);

CREATE TABLE video_session_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES video_sessions(id) ON DELETE CASCADE,
  actor_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('member', 'coach', 'system')),
  event_type text NOT NULL,
  from_status text,
  to_status text,
  session_version integer NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX video_session_events_session_idx ON video_session_events(session_id, created_at DESC, id DESC);

-- Add optional fields understood by newer drains while preserving the old columns.
ALTER TABLE push_outbox ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE push_outbox ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS push_outbox_idempotency_key_idx
  ON push_outbox(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE video_staff_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_session_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_session_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_video_staff(p_account_id uuid DEFAULT my_account_id())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM video_staff_roles r WHERE r.account_id = p_account_id AND r.active)
$$;
CREATE OR REPLACE FUNCTION is_video_owner(p_account_id uuid DEFAULT my_account_id())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM video_staff_roles r WHERE r.account_id = p_account_id AND r.role = 'owner' AND r.active)
$$;

DROP POLICY IF EXISTS "video sessions: owner/admin select" ON video_sessions;
DROP POLICY IF EXISTS "video sessions: owner request" ON video_sessions;
DROP POLICY IF EXISTS "video sessions: admin update" ON video_sessions;
CREATE POLICY "video sessions: member or staff read" ON video_sessions FOR SELECT TO authenticated
  USING (account_id = my_account_id() OR is_video_staff());
-- No direct INSERT/UPDATE/DELETE policies: all state transitions use audited RPCs.

CREATE POLICY "video staff: staff read" ON video_staff_roles FOR SELECT TO authenticated USING (is_video_staff());
CREATE POLICY "video proposals: participant read" ON video_session_proposals FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM video_sessions s WHERE s.id = session_id AND (s.account_id = my_account_id() OR is_video_staff())));
CREATE POLICY "video events: participant read" ON video_session_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM video_sessions s WHERE s.id = session_id AND (s.account_id = my_account_id() OR is_video_staff())));

CREATE OR REPLACE FUNCTION owner_set_video_staff_role(p_account_id uuid, p_role text, p_active boolean DEFAULT true)
RETURNS video_staff_roles LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row video_staff_roles;
BEGIN
  IF NOT is_video_owner() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_role NOT IN ('owner','coach') THEN RAISE EXCEPTION 'invalid_role'; END IF;
  IF p_account_id = my_account_id() AND (NOT p_active OR p_role <> 'owner') THEN
    RAISE EXCEPTION 'owner_cannot_demote_self';
  END IF;
  INSERT INTO video_staff_roles(account_id,role,active)
  VALUES(p_account_id,p_role,p_active)
  ON CONFLICT(account_id) DO UPDATE SET role=EXCLUDED.role,active=EXCLUDED.active,updated_at=now()
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION _video_assert_timezone(p_timezone text)
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF p_timezone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'invalid_timezone' USING ERRCODE = '22023';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION _video_assert_version(p_actual integer, p_expected integer)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = public AS $$
BEGIN
  IF p_expected IS NULL OR p_actual <> p_expected THEN
    RAISE EXCEPTION 'version_conflict' USING ERRCODE = '40001', DETAIL = format('expected %s, actual %s', p_expected, p_actual);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION _video_assert_coach_available(
  p_coach_id uuid, p_session_id uuid, p_starts_at timestamptz, p_duration_minutes integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM video_staff_roles WHERE account_id = p_coach_id AND active) THEN
    RAISE EXCEPTION 'invalid_or_inactive_coach';
  END IF;
  -- Serializes schedule decisions for one coach, closing the race between check/update.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_coach_id::text, 90421));
  IF EXISTS (
    SELECT 1 FROM video_sessions s
    WHERE s.assigned_coach_id = p_coach_id AND s.id <> p_session_id
      AND s.status IN ('scheduled', 'live') AND s.scheduled_for IS NOT NULL
      AND tstzrange(s.scheduled_for, s.scheduled_for + make_interval(mins => s.duration_minutes), '[)')
          && tstzrange(p_starts_at, p_starts_at + make_interval(mins => p_duration_minutes), '[)')
  ) THEN RAISE EXCEPTION 'coach_schedule_conflict' USING ERRCODE = '23P01'; END IF;
END $$;

CREATE OR REPLACE FUNCTION _video_event(p_session video_sessions, p_actor uuid, p_role text, p_type text, p_from text, p_metadata jsonb DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO video_session_events(session_id, actor_account_id, actor_role, event_type, from_status, to_status, session_version, metadata)
  VALUES(p_session.id, p_actor, p_role, p_type, p_from, p_session.status, p_session.version, COALESCE(p_metadata, '{}'));
END $$;

CREATE OR REPLACE FUNCTION _video_push(p_account uuid, p_kind text, p_title text, p_body text, p_session uuid, p_version integer, p_event text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO push_outbox(account_id, kind, title, body, metadata, idempotency_key)
  VALUES(p_account, p_kind, p_title, p_body,
    jsonb_build_object('kind', p_kind, 'deep_link', 'soberhelpline://premier-video/' || p_session::text, 'screen', 'premier-video', 'session_id', p_session, 'event', p_event),
    'video:' || p_session::text || ':' || p_version::text || ':' || p_event)
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION request_private_video_session(p_starts_at timestamptz, p_timezone text, p_duration_minutes integer, p_note text DEFAULT NULL)
RETURNS video_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account uuid := my_account_id(); v_row video_sessions; v_owner uuid;
BEGIN
  IF v_account IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF NOT has_active_private_video_access(v_account) THEN RAISE EXCEPTION 'premium_video_access_required'; END IF;
  PERFORM _video_assert_timezone(p_timezone);
  IF p_starts_at IS NULL OR p_starts_at <= now() OR p_duration_minutes NOT BETWEEN 15 AND 240 OR length(COALESCE(p_note,'')) > 2000 THEN RAISE EXCEPTION 'invalid_request'; END IF;
  INSERT INTO video_sessions(account_id, room_name, status, requested_start, requested_timezone, duration_minutes, member_note)
  VALUES(v_account, 'premium-video-' || gen_random_uuid(), 'requested', p_starts_at, p_timezone, p_duration_minutes, NULLIF(btrim(p_note),'')) RETURNING * INTO v_row;
  INSERT INTO video_session_proposals(session_id, proposed_by_account_id, proposed_by_role, starts_at, timezone, duration_minutes, note)
  VALUES(v_row.id, v_account, 'member', p_starts_at, p_timezone, p_duration_minutes, NULLIF(btrim(p_note),''));
  PERFORM _video_event(v_row, v_account, 'member', 'requested', NULL, jsonb_build_object('timezone',p_timezone));
  FOR v_owner IN SELECT account_id FROM video_staff_roles WHERE active LOOP
    PERFORM _video_push(v_owner, 'admin_video_request', 'New private video request', 'A member requested a Premier video session.', v_row.id, v_row.version, 'requested');
  END LOOP;
  RETURN v_row;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'active_session_exists' USING ERRCODE='23505';
END $$;

CREATE OR REPLACE FUNCTION coach_confirm_video_session(p_session_id uuid, p_expected_version integer, p_coach_id uuid DEFAULT NULL)
RETURNS video_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := my_account_id(); v_row video_sessions; v_old text;
BEGIN
  IF NOT is_video_staff(v_actor) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO v_row FROM video_sessions WHERE id=p_session_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  PERFORM _video_assert_version(v_row.version,p_expected_version); IF v_row.status <> 'requested' THEN RAISE EXCEPTION 'invalid_transition'; END IF;
  v_old:=v_row.status; v_row.assigned_coach_id:=COALESCE(p_coach_id,v_actor);
  PERFORM _video_assert_coach_available(v_row.assigned_coach_id,v_row.id,v_row.requested_start,v_row.duration_minutes);
  UPDATE video_session_proposals SET status='accepted',responded_at=now() WHERE session_id=v_row.id AND status='pending';
  UPDATE video_sessions SET assigned_coach_id=v_row.assigned_coach_id,scheduled_for=requested_start,status='scheduled',calendar_sync_status='pending',calendar_sync_error=NULL,version=version+1 WHERE id=v_row.id RETURNING * INTO v_row;
  PERFORM _video_event(v_row,v_actor,'coach','confirmed',v_old); PERFORM _video_push(v_row.account_id,'member_video_scheduled','Video session confirmed','Your Premier video session was confirmed.',v_row.id,v_row.version,'confirmed'); RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION coach_counteroffer_video_session(p_session_id uuid,p_expected_version integer,p_starts_at timestamptz,p_timezone text,p_duration_minutes integer,p_note text DEFAULT NULL,p_coach_id uuid DEFAULT NULL)
RETURNS video_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid:=my_account_id(); v_row video_sessions; v_coach uuid:=COALESCE(p_coach_id,v_actor);
BEGIN
 IF NOT is_video_staff(v_actor) THEN RAISE EXCEPTION 'not_authorized'; END IF; PERFORM _video_assert_timezone(p_timezone);
 SELECT * INTO v_row FROM video_sessions WHERE id=p_session_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF; PERFORM _video_assert_version(v_row.version,p_expected_version);
 IF v_row.status NOT IN ('requested','scheduled') OR p_starts_at <= now() OR p_duration_minutes NOT BETWEEN 15 AND 240 THEN RAISE EXCEPTION 'invalid_transition'; END IF;
 PERFORM _video_assert_coach_available(v_coach,v_row.id,p_starts_at,p_duration_minutes);
 UPDATE video_session_proposals SET status='superseded',responded_at=now() WHERE session_id=v_row.id AND status='pending';
 INSERT INTO video_session_proposals(session_id,proposed_by_account_id,proposed_by_role,coach_id,starts_at,timezone,duration_minutes,note) VALUES(v_row.id,v_actor,'coach',v_coach,p_starts_at,p_timezone,p_duration_minutes,NULLIF(btrim(p_note),''));
 UPDATE video_sessions SET assigned_coach_id=v_coach,scheduled_for=NULL,status='requested',calendar_sync_status=CASE WHEN calendar_event_id IS NULL THEN 'not_synced' ELSE 'pending' END,calendar_sync_error=NULL,version=version+1 WHERE id=v_row.id RETURNING * INTO v_row;
 PERFORM _video_event(v_row,v_actor,'coach','counteroffered',NULL); PERFORM _video_push(v_row.account_id,'member_video_counteroffer','New video time proposed','Your coach proposed a new Premier video time.',v_row.id,v_row.version,'counteroffer'); RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION member_accept_video_proposal(p_session_id uuid,p_proposal_id uuid,p_expected_version integer)
RETURNS video_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid:=my_account_id(); v_row video_sessions; v_prop video_session_proposals; v_old text;
BEGIN
 SELECT * INTO v_row FROM video_sessions WHERE id=p_session_id AND account_id=v_actor FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF; PERFORM _video_assert_version(v_row.version,p_expected_version);
 SELECT * INTO v_prop FROM video_session_proposals WHERE id=p_proposal_id AND session_id=v_row.id AND status='pending' AND proposed_by_role='coach' FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'proposal_not_found'; END IF;
 PERFORM _video_assert_coach_available(v_prop.coach_id,v_row.id,v_prop.starts_at,v_prop.duration_minutes); v_old:=v_row.status;
 UPDATE video_session_proposals SET status=CASE WHEN id=v_prop.id THEN 'accepted' ELSE 'superseded' END,responded_at=now() WHERE session_id=v_row.id AND status='pending';
 UPDATE video_sessions SET assigned_coach_id=v_prop.coach_id,scheduled_for=v_prop.starts_at,requested_timezone=v_prop.timezone,duration_minutes=v_prop.duration_minutes,status='scheduled',calendar_sync_status='pending',calendar_sync_error=NULL,version=version+1 WHERE id=v_row.id RETURNING * INTO v_row;
 PERFORM _video_event(v_row,v_actor,'member','proposal_accepted',v_old,jsonb_build_object('proposal_id',v_prop.id)); PERFORM _video_push(v_prop.coach_id,'coach_video_accepted','Video proposal accepted','A member accepted your proposed video time.',v_row.id,v_row.version,'accepted'); RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION member_reschedule_video_session(p_session_id uuid,p_expected_version integer,p_starts_at timestamptz,p_timezone text,p_duration_minutes integer,p_note text DEFAULT NULL)
RETURNS video_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid:=my_account_id(); v_row video_sessions;
BEGIN
 PERFORM _video_assert_timezone(p_timezone); SELECT * INTO v_row FROM video_sessions WHERE id=p_session_id AND account_id=v_actor FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF; PERFORM _video_assert_version(v_row.version,p_expected_version);
 IF v_row.status NOT IN ('requested','scheduled') OR p_starts_at <= now() OR p_duration_minutes NOT BETWEEN 15 AND 240 THEN RAISE EXCEPTION 'invalid_transition'; END IF;
 UPDATE video_session_proposals SET status='superseded',responded_at=now() WHERE session_id=v_row.id AND status='pending';
 INSERT INTO video_session_proposals(session_id,proposed_by_account_id,proposed_by_role,coach_id,starts_at,timezone,duration_minutes,note) VALUES(v_row.id,v_actor,'member',v_row.assigned_coach_id,p_starts_at,p_timezone,p_duration_minutes,NULLIF(btrim(p_note),''));
 UPDATE video_sessions SET requested_start=p_starts_at,requested_timezone=p_timezone,duration_minutes=p_duration_minutes,member_note=NULLIF(btrim(p_note),''),scheduled_for=NULL,status='requested',calendar_sync_status=CASE WHEN calendar_event_id IS NULL THEN 'not_synced' ELSE 'pending' END,calendar_sync_error=NULL,version=version+1 WHERE id=v_row.id RETURNING * INTO v_row;
 PERFORM _video_event(v_row,v_actor,'member','reschedule_requested',NULL); IF v_row.assigned_coach_id IS NOT NULL THEN PERFORM _video_push(v_row.assigned_coach_id,'coach_video_reschedule','Video reschedule requested','A member requested a new Premier video time.',v_row.id,v_row.version,'reschedule_requested'); END IF; RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION coach_reschedule_video_session(p_session_id uuid,p_expected_version integer,p_starts_at timestamptz,p_timezone text,p_duration_minutes integer,p_note text DEFAULT NULL)
RETURNS video_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_coach uuid;
BEGIN
 SELECT assigned_coach_id INTO v_coach FROM video_sessions WHERE id=p_session_id;
 IF v_coach IS NULL THEN RAISE EXCEPTION 'assigned_coach_required'; END IF;
 RETURN coach_counteroffer_video_session(p_session_id,p_expected_version,p_starts_at,p_timezone,p_duration_minutes,p_note,v_coach);
END $$;

CREATE OR REPLACE FUNCTION _video_cancel(p_session_id uuid,p_expected_version integer,p_actor uuid,p_role text,p_reason text)
RETURNS video_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row video_sessions; v_old text;
BEGIN
 SELECT * INTO v_row FROM video_sessions WHERE id=p_session_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF; PERFORM _video_assert_version(v_row.version,p_expected_version); IF v_row.status NOT IN ('requested','scheduled') THEN RAISE EXCEPTION 'invalid_transition'; END IF; v_old:=v_row.status;
 UPDATE video_session_proposals SET status='superseded',responded_at=now() WHERE session_id=v_row.id AND status='pending';
 UPDATE video_sessions SET status='cancelled',cancelled_at=now(),ended_at=COALESCE(ended_at,now()),archived_at=now(),cancelled_by_account_id=p_actor,cancellation_reason=NULLIF(btrim(p_reason),''),calendar_sync_status=CASE WHEN calendar_event_id IS NULL THEN 'cancelled' ELSE 'pending' END,calendar_sync_error=NULL,version=version+1 WHERE id=v_row.id RETURNING * INTO v_row;
 PERFORM _video_event(v_row,p_actor,p_role,'cancelled',v_old,jsonb_build_object('reason',p_reason)); RETURN v_row;
END $$;
CREATE OR REPLACE FUNCTION member_cancel_video_session(p_session_id uuid,p_expected_version integer,p_reason text DEFAULT NULL)
RETURNS video_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE v_actor uuid:=my_account_id(); v_row video_sessions; BEGIN IF NOT EXISTS(SELECT 1 FROM video_sessions WHERE id=p_session_id AND account_id=v_actor) THEN RAISE EXCEPTION 'session_not_found'; END IF; v_row:=_video_cancel(p_session_id,p_expected_version,v_actor,'member',p_reason); IF v_row.assigned_coach_id IS NOT NULL THEN PERFORM _video_push(v_row.assigned_coach_id,'coach_video_cancelled','Video session cancelled','A member cancelled a Premier video session.',v_row.id,v_row.version,'cancelled'); END IF; RETURN v_row; END $$;
CREATE OR REPLACE FUNCTION coach_cancel_video_session(p_session_id uuid,p_expected_version integer,p_reason text DEFAULT NULL)
RETURNS video_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ DECLARE v_actor uuid:=my_account_id(); v_row video_sessions; BEGIN IF NOT is_video_staff(v_actor) THEN RAISE EXCEPTION 'not_authorized'; END IF; v_row:=_video_cancel(p_session_id,p_expected_version,v_actor,'coach',p_reason); PERFORM _video_push(v_row.account_id,'member_video_cancelled','Video session cancelled','Your Premier video session was cancelled.',v_row.id,v_row.version,'cancelled'); RETURN v_row; END $$;

CREATE OR REPLACE FUNCTION _coach_video_transition(p_session_id uuid,p_expected_version integer,p_target text,p_event text)
RETURNS video_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_actor uuid:=my_account_id(); v_row video_sessions; v_old text;
BEGIN IF NOT is_video_staff(v_actor) THEN RAISE EXCEPTION 'not_authorized'; END IF; SELECT * INTO v_row FROM video_sessions WHERE id=p_session_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF; PERFORM _video_assert_version(v_row.version,p_expected_version);
 IF (p_target='live' AND v_row.status<>'scheduled') OR (p_target IN ('completed','no_show') AND v_row.status NOT IN ('scheduled','live')) THEN RAISE EXCEPTION 'invalid_transition'; END IF;
 IF v_row.assigned_coach_id IS DISTINCT FROM v_actor AND NOT is_video_owner(v_actor) THEN RAISE EXCEPTION 'not_assigned_coach'; END IF; v_old:=v_row.status;
 UPDATE video_sessions SET status=p_target,
   started_at=CASE WHEN p_target='live' THEN COALESCE(started_at,now()) ELSE started_at END,
   ended_at=CASE WHEN p_target IN ('completed','no_show') THEN COALESCE(ended_at,now()) ELSE ended_at END,
   archived_at=CASE WHEN p_target IN ('completed','no_show') THEN now() ELSE archived_at END,
   completion_outcome=CASE WHEN p_target='completed' THEN 'completed' WHEN p_event='member_no_show' THEN 'member_no_show' WHEN p_event='coach_no_show' THEN 'coach_no_show' ELSE completion_outcome END,
   calendar_sync_status=CASE WHEN p_target='no_show' AND calendar_event_id IS NOT NULL THEN 'pending' ELSE calendar_sync_status END,
   calendar_sync_error=CASE WHEN p_target='no_show' THEN NULL ELSE calendar_sync_error END,
   version=version+1
 WHERE id=v_row.id RETURNING * INTO v_row;
 PERFORM _video_event(v_row,v_actor,'coach',p_event,v_old); PERFORM _video_push(v_row.account_id,'member_video_'||p_target,CASE WHEN p_target='live' THEN 'Your video session is starting' ELSE 'Video session updated' END,CASE WHEN p_target='live' THEN 'Open Sober Helpline to join your Premier video session.' ELSE 'Your Premier video session was updated.' END,v_row.id,v_row.version,p_event); RETURN v_row; END $$;
CREATE OR REPLACE FUNCTION coach_start_video_session(p_session_id uuid,p_expected_version integer) RETURNS video_sessions LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT _coach_video_transition(p_session_id,p_expected_version,'live','started') $$;
CREATE OR REPLACE FUNCTION coach_complete_video_session(p_session_id uuid,p_expected_version integer) RETURNS video_sessions LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT _coach_video_transition(p_session_id,p_expected_version,'completed','completed') $$;
CREATE OR REPLACE FUNCTION coach_mark_member_no_show(p_session_id uuid,p_expected_version integer) RETURNS video_sessions LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT _coach_video_transition(p_session_id,p_expected_version,'no_show','member_no_show') $$;
CREATE OR REPLACE FUNCTION coach_mark_coach_no_show(p_session_id uuid,p_expected_version integer) RETURNS video_sessions LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT _coach_video_transition(p_session_id,p_expected_version,'no_show','coach_no_show') $$;

CREATE OR REPLACE FUNCTION member_get_active_video_session()
RETURNS SETOF video_sessions LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$ SELECT * FROM video_sessions WHERE account_id=my_account_id() AND status IN ('requested','scheduled','live') ORDER BY created_at DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION member_get_video_session_history(p_limit integer DEFAULT 25,p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL)
RETURNS SETOF video_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_limit'; END IF; RETURN QUERY SELECT s.* FROM video_sessions s WHERE s.account_id=my_account_id() AND s.status IN ('completed','cancelled','no_show') AND (p_before IS NULL OR (COALESCE(s.ended_at,s.cancelled_at,s.updated_at),s.id)<(p_before,COALESCE(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))) ORDER BY COALESCE(s.ended_at,s.cancelled_at,s.updated_at) DESC,s.id DESC LIMIT p_limit; END $$;
CREATE OR REPLACE FUNCTION admin_get_active_video_sessions()
RETURNS SETOF video_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF NOT is_video_staff() THEN RAISE EXCEPTION 'not_authorized'; END IF; RETURN QUERY SELECT s.* FROM video_sessions s WHERE s.status IN ('requested','scheduled','live') ORDER BY CASE s.status WHEN 'live' THEN 1 WHEN 'requested' THEN 2 ELSE 3 END,COALESCE(s.scheduled_for,s.requested_start,s.created_at),s.id; END $$;
CREATE OR REPLACE FUNCTION admin_get_video_session_history(p_limit integer DEFAULT 50,p_before timestamptz DEFAULT NULL,p_before_id uuid DEFAULT NULL)
RETURNS SETOF video_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN IF NOT is_video_staff() THEN RAISE EXCEPTION 'not_authorized'; END IF; IF p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'invalid_limit'; END IF; RETURN QUERY SELECT s.* FROM video_sessions s WHERE s.status IN ('completed','cancelled','no_show') AND (p_before IS NULL OR (COALESCE(s.ended_at,s.cancelled_at,s.updated_at),s.id)<(p_before,COALESCE(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid))) ORDER BY COALESCE(s.ended_at,s.cancelled_at,s.updated_at) DESC,s.id DESC LIMIT p_limit; END $$;

CREATE OR REPLACE FUNCTION admin_get_video_people(p_account_ids uuid[])
RETURNS TABLE(account_id uuid, first_name text, last_name text, email text, timezone text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT is_video_staff() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_account_ids IS NULL OR cardinality(p_account_ids) > 200 THEN RAISE EXCEPTION 'invalid_account_ids'; END IF;
  RETURN QUERY
  SELECT a.id, a.first_name, a.last_name, u.email::text, COALESCE(NULLIF(a.timezone,''),'America/Los_Angeles')
  FROM accounts a
  LEFT JOIN auth.users u ON u.id=a.user_id
  WHERE a.id=ANY(p_account_ids);
END $$;

-- Keep archival/timestamps/versioning correct even for privileged maintenance writes.
CREATE OR REPLACE FUNCTION set_video_session_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.updated_at=now(); IF NEW.status='live' AND OLD.status IS DISTINCT FROM 'live' THEN NEW.started_at=COALESCE(NEW.started_at,now()); END IF; IF NEW.status IN ('completed','cancelled','no_show') AND OLD.status IS DISTINCT FROM NEW.status THEN NEW.ended_at=COALESCE(NEW.ended_at,now()); NEW.archived_at=COALESCE(NEW.archived_at,now()); END IF; RETURN NEW; END $$;

-- Scheduling RPCs own idempotent notifications; retire legacy video triggers that
-- enqueue duplicate, metadata-free rows.
DROP TRIGGER IF EXISTS trg_notify_admin_video_request ON video_sessions;
DROP TRIGGER IF EXISTS trg_notify_member_video_update ON video_sessions;

-- Retire legacy mutation RPCs that bypass exact-request and optimistic-version rules.
DROP FUNCTION IF EXISTS request_private_video_session();
DROP FUNCTION IF EXISTS admin_update_video_session(uuid,text,timestamptz);
DROP FUNCTION IF EXISTS admin_get_video_sessions();

REVOKE ALL ON video_staff_roles,video_session_proposals,video_session_events FROM anon,authenticated;
GRANT SELECT ON video_staff_roles,video_session_proposals,video_session_events TO authenticated;
GRANT ALL ON video_staff_roles,video_session_proposals,video_session_events TO service_role;

-- PostgreSQL grants EXECUTE to PUBLIC at creation, so explicitly lock down every
-- new definer/helper and then expose only the caller-facing authenticated RPCs.
REVOKE EXECUTE ON FUNCTION is_video_staff(uuid),is_video_owner(uuid),owner_set_video_staff_role(uuid,text,boolean),_video_assert_timezone(text),_video_assert_version(integer,integer),_video_assert_coach_available(uuid,uuid,timestamptz,integer),_video_event(video_sessions,uuid,text,text,text,jsonb),_video_push(uuid,text,text,text,uuid,integer,text),_video_cancel(uuid,integer,uuid,text,text),_coach_video_transition(uuid,integer,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION request_private_video_session(timestamptz,text,integer,text),member_accept_video_proposal(uuid,uuid,integer),member_reschedule_video_session(uuid,integer,timestamptz,text,integer,text),member_cancel_video_session(uuid,integer,text),member_get_active_video_session(),member_get_video_session_history(integer,timestamptz,uuid),coach_confirm_video_session(uuid,integer,uuid),coach_counteroffer_video_session(uuid,integer,timestamptz,text,integer,text,uuid),coach_reschedule_video_session(uuid,integer,timestamptz,text,integer,text),coach_cancel_video_session(uuid,integer,text),coach_start_video_session(uuid,integer),coach_complete_video_session(uuid,integer),coach_mark_member_no_show(uuid,integer),coach_mark_coach_no_show(uuid,integer),admin_get_active_video_sessions(),admin_get_video_session_history(integer,timestamptz,uuid),admin_get_video_people(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_private_video_session(timestamptz,text,integer,text),member_accept_video_proposal(uuid,uuid,integer),member_reschedule_video_session(uuid,integer,timestamptz,text,integer,text),member_cancel_video_session(uuid,integer,text),member_get_active_video_session(),member_get_video_session_history(integer,timestamptz,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION coach_confirm_video_session(uuid,integer,uuid),coach_counteroffer_video_session(uuid,integer,timestamptz,text,integer,text,uuid),coach_reschedule_video_session(uuid,integer,timestamptz,text,integer,text),coach_cancel_video_session(uuid,integer,text),coach_start_video_session(uuid,integer),coach_complete_video_session(uuid,integer),coach_mark_member_no_show(uuid,integer),coach_mark_coach_no_show(uuid,integer),admin_get_active_video_sessions(),admin_get_video_session_history(integer,timestamptz,uuid),admin_get_video_people(uuid[]),owner_set_video_staff_role(uuid,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION is_video_staff(uuid),is_video_owner(uuid),owner_set_video_staff_role(uuid,text,boolean),_video_assert_timezone(text),_video_assert_version(integer,integer),_video_assert_coach_available(uuid,uuid,timestamptz,integer),_video_event(video_sessions,uuid,text,text,text,jsonb),_video_push(uuid,text,text,text,uuid,integer,text),_video_cancel(uuid,integer,uuid,text,text),_coach_video_transition(uuid,integer,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION request_private_video_session(timestamptz,text,integer,text),member_accept_video_proposal(uuid,uuid,integer),member_reschedule_video_session(uuid,integer,timestamptz,text,integer,text),member_cancel_video_session(uuid,integer,text),member_get_active_video_session(),member_get_video_session_history(integer,timestamptz,uuid),coach_confirm_video_session(uuid,integer,uuid),coach_counteroffer_video_session(uuid,integer,timestamptz,text,integer,text,uuid),coach_reschedule_video_session(uuid,integer,timestamptz,text,integer,text),coach_cancel_video_session(uuid,integer,text),coach_start_video_session(uuid,integer),coach_complete_video_session(uuid,integer),coach_mark_member_no_show(uuid,integer),coach_mark_coach_no_show(uuid,integer),admin_get_active_video_sessions(),admin_get_video_session_history(integer,timestamptz,uuid),admin_get_video_people(uuid[]) TO service_role;
