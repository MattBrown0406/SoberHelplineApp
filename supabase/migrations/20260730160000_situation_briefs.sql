-- =============================================================================
-- Situation Briefs — "Send Matt this week"
--
-- When a family's situation escalates (elevated/crisis), the app offers to put
-- their last two weeks directly in front of Matt: mood arc, warning signs,
-- boundaries, loved-one status, recent practice — plus a note in their own
-- words. Server-authoritative: the client never supplies the data, it only
-- consents to sending it. Matt reads the brief in the admin screen and replies
-- through the existing member thread.
--
-- Table:  situation_briefs (owner read via RLS; writes/admin via RPCs)
-- RPCs:   preview_situation_brief()            — member: exactly what will be sent
--         send_situation_brief(p_note)         — member: insert + notify admins
--         admin_get_situation_briefs()         — admin: inbox list
--         admin_get_situation_brief(p_id)      — admin: one brief, full sections
--         admin_mark_brief(p_id, p_status)     — admin: read/replied bookkeeping
--         admin_get_or_create_thread(p_account_id) — admin: reply channel
-- =============================================================================

-- New funnel stages: opening the brief screen and sending a brief are the two
-- strongest escalation-to-connection signals the funnel now has.
ALTER TABLE funnel_events DROP CONSTRAINT IF EXISTS funnel_events_stage_check;
ALTER TABLE funnel_events ADD CONSTRAINT funnel_events_stage_check
  CHECK (stage IN ('rsvp', 'attended', 'coaching_requested',
                   'intervention_viewed', 'intervention_started',
                   'brief_opened', 'brief_sent'));

CREATE TABLE IF NOT EXISTS situation_briefs (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  band       text        NOT NULL CHECK (band IN ('calm','watch','elevated','crisis')),
  score      int         NOT NULL DEFAULT 0,
  sustained  boolean     NOT NULL DEFAULT false,
  sections   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  note       text        CHECK (note IS NULL OR length(note) <= 2000),
  status     text        NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','read','replied')),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz,
  replied_at timestamptz
);

COMMENT ON TABLE situation_briefs IS
  'Member-initiated escalation briefs sent to Matt. Sections are assembled '
  'server-side from the member''s own recent data at send time; the client '
  'only supplies the optional note and the consent tap.';

CREATE INDEX IF NOT EXISTS situation_briefs_account_created_idx
  ON situation_briefs (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS situation_briefs_status_idx
  ON situation_briefs (status, created_at DESC);

ALTER TABLE situation_briefs ENABLE ROW LEVEL SECURITY;

-- Members see their own briefs (status updates included). All writes go
-- through SECURITY DEFINER RPCs; there is intentionally no INSERT/UPDATE
-- policy for members or admins.
DROP POLICY IF EXISTS "situation_briefs: owner select" ON situation_briefs;
CREATE POLICY "situation_briefs: owner select" ON situation_briefs FOR SELECT
  USING (account_id = my_account_id());

GRANT SELECT ON situation_briefs TO authenticated;

-- ─── Section builder (internal) ──────────────────────────────────────────────
-- Assembles the shareable snapshot from the member's own rows. Windows match
-- my_situation(): mood 7 days, tracker 14 days. Bounded everywhere.
CREATE OR REPLACE FUNCTION build_situation_brief_sections(p_account uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mood      jsonb;
  v_tracker   jsonb;
  v_walls     jsonb;
  v_loved_one jsonb;
  v_rehearsal jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'day',  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
           'mood', mood,
           'note', note
         ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_mood
  FROM (
    SELECT created_at, mood, note
    FROM checkins
    WHERE account_id = p_account
      AND created_at >= now() - interval '7 days'
    ORDER BY created_at DESC
    LIMIT 7
  ) c;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'sign_key', sign_key,
           'kind',     kind,
           'week',     to_char(week, 'YYYY-MM-DD')
         ) ORDER BY week DESC, sign_key), '[]'::jsonb)
  INTO v_tracker
  FROM (
    SELECT sign_key, kind, week
    FROM tracker_logs
    WHERE account_id = p_account
      AND week >= (CURRENT_DATE - 14)
    ORDER BY week DESC, sign_key
    LIMIT 40
  ) t;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'text',       text,
           'anchor',     anchor,
           'created_at', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
         ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_walls
  FROM (
    SELECT text, anchor, created_at
    FROM walls
    WHERE account_id = p_account
    ORDER BY created_at DESC
    LIMIT 8
  ) w;

  SELECT to_jsonb(lo) - 'id' - 'account_id' - 'created_at' - 'updated_at'
  INTO v_loved_one
  FROM loved_ones lo
  WHERE lo.account_id = p_account;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'created_at', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
           'scores',     debrief -> 'scores'
         ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_rehearsal
  FROM (
    SELECT created_at, debrief
    FROM rehearsal_sessions
    WHERE account_id = p_account
      AND debrief IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 3
  ) r;

  RETURN jsonb_build_object(
    'mood',         v_mood,
    'tracker',      v_tracker,
    'boundaries',   v_walls,
    'loved_one',    coalesce(v_loved_one, 'null'::jsonb),
    'rehearsal',    v_rehearsal,
    'generated_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
END;
$$;

-- Internal only: callable from the definer RPCs below, never from clients.
REVOKE EXECUTE ON FUNCTION build_situation_brief_sections(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION build_situation_brief_sections(uuid) TO service_role;

-- ─── Member: preview ─────────────────────────────────────────────────────────
-- "This is exactly what Matt will see" — plus whether Send is currently allowed
-- (one brief per 20 hours keeps the channel meaningful).
CREATE OR REPLACE FUNCTION preview_situation_brief()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := my_account_id();
  v_last    timestamptz;
BEGIN
  IF v_account IS NULL THEN RAISE EXCEPTION 'no_account'; END IF;

  SELECT max(created_at) INTO v_last
  FROM situation_briefs
  WHERE account_id = v_account;

  RETURN jsonb_build_object(
    'situation',       my_situation(),
    'sections',        build_situation_brief_sections(v_account),
    'can_send',        (v_last IS NULL OR v_last < now() - interval '20 hours'),
    'next_allowed_at', CASE
      WHEN v_last IS NULL OR v_last < now() - interval '20 hours' THEN NULL
      ELSE to_char((v_last + interval '20 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION preview_situation_brief() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION preview_situation_brief() TO authenticated, service_role;

-- ─── Member: send ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION send_situation_brief(p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account    uuid := my_account_id();
  v_last       timestamptz;
  v_situation  jsonb;
  v_sections   jsonb;
  v_brief_id   uuid;
  v_created_at timestamptz;
  v_first_name text;
BEGIN
  IF v_account IS NULL THEN RAISE EXCEPTION 'no_account'; END IF;
  IF p_note IS NOT NULL AND length(p_note) > 2000 THEN
    RAISE EXCEPTION 'note_too_long';
  END IF;

  SELECT max(created_at) INTO v_last
  FROM situation_briefs
  WHERE account_id = v_account;

  IF v_last IS NOT NULL AND v_last >= now() - interval '20 hours' THEN
    RAISE EXCEPTION 'too_soon';
  END IF;

  v_situation := my_situation();
  v_sections  := build_situation_brief_sections(v_account);

  INSERT INTO situation_briefs (account_id, band, score, sustained, sections, note)
  VALUES (
    v_account,
    coalesce(v_situation ->> 'band', 'calm'),
    coalesce((v_situation ->> 'score')::int, 0),
    coalesce((v_situation ->> 'sustained')::boolean, false),
    v_sections || jsonb_build_object('situation', v_situation),
    nullif(trim(p_note), '')
  )
  RETURNING id, created_at INTO v_brief_id, v_created_at;

  -- Funnel: a sent brief is the clearest escalation→connection event we have.
  INSERT INTO funnel_events (account_id, stage, metadata)
  VALUES (v_account, 'brief_sent', jsonb_build_object('band', v_situation ->> 'band'));

  SELECT first_name INTO v_first_name FROM accounts WHERE id = v_account;

  -- Notify every admin device via the existing engagement-push outbox
  -- (drained by send-engagement-push's `drain` job). metadata.kind routes the
  -- tap to the admin screen (see src/lib/pushRouting.ts).
  INSERT INTO push_outbox (account_id, kind, title, body, metadata)
  SELECT a.id,
         'situation_brief',
         'Situation brief — ' || coalesce(v_first_name, 'a member'),
         initcap(coalesce(v_situation ->> 'band', 'calm'))
           || ' · score ' || coalesce(v_situation ->> 'score', '0')
           || CASE WHEN nullif(trim(p_note), '') IS NOT NULL THEN ' · has a note' ELSE '' END,
         jsonb_build_object('kind', 'situation_brief', 'brief_id', v_brief_id)
  FROM accounts a
  JOIN auth.users u ON u.id = a.user_id
  WHERE lower(coalesce(u.email, '')) = ANY (admin_email_list());

  RETURN jsonb_build_object(
    'id',         v_brief_id,
    'created_at', to_char(v_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION send_situation_brief(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION send_situation_brief(text) TO authenticated, service_role;

-- ─── Admin: inbox ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_get_situation_briefs()
RETURNS TABLE (
  id         uuid,
  account_id uuid,
  first_name text,
  last_name  text,
  email      text,
  band       text,
  score      int,
  sustained  boolean,
  note       text,
  status     text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin_jwt() THEN RAISE EXCEPTION 'not authorized'; END IF;

  RETURN QUERY
  SELECT b.id, b.account_id,
         a.first_name, a.last_name, u.email::text,
         b.band, b.score, b.sustained, b.note, b.status, b.created_at
  FROM situation_briefs b
  JOIN accounts a ON a.id = b.account_id
  LEFT JOIN auth.users u ON u.id = a.user_id
  ORDER BY b.created_at DESC
  LIMIT 100;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_get_situation_briefs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_get_situation_briefs() TO authenticated, service_role;

-- ─── Admin: one brief, full sections ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_get_situation_brief(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT is_admin_jwt() THEN RAISE EXCEPTION 'not authorized'; END IF;

  SELECT jsonb_build_object(
    'id',         b.id,
    'account_id', b.account_id,
    'first_name', a.first_name,
    'last_name',  a.last_name,
    'email',      u.email,
    'band',       b.band,
    'score',      b.score,
    'sustained',  b.sustained,
    'sections',   b.sections,
    'note',       b.note,
    'status',     b.status,
    'created_at', to_char(b.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )
  INTO v_result
  FROM situation_briefs b
  JOIN accounts a ON a.id = b.account_id
  LEFT JOIN auth.users u ON u.id = a.user_id
  WHERE b.id = p_id;

  IF v_result IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_get_situation_brief(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_get_situation_brief(uuid) TO authenticated, service_role;

-- ─── Admin: read/replied bookkeeping ─────────────────────────────────────────
-- Status only moves forward (sent → read → replied) so a later "read" can't
-- erase a "replied".
CREATE OR REPLACE FUNCTION admin_mark_brief(p_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin_jwt() THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF p_status NOT IN ('read', 'replied') THEN RAISE EXCEPTION 'bad_status'; END IF;

  UPDATE situation_briefs
  SET status     = CASE
                     WHEN p_status = 'replied' THEN 'replied'
                     WHEN status = 'sent'      THEN 'read'
                     ELSE status
                   END,
      read_at    = coalesce(read_at, now()),
      replied_at = CASE WHEN p_status = 'replied' THEN coalesce(replied_at, now()) ELSE replied_at END
  WHERE id = p_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_mark_brief(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_mark_brief(uuid, text) TO authenticated, service_role;

-- ─── Admin: open (or create) the member's thread to reply ────────────────────
-- Mirrors the member client's select-active-else-create flow. If creation hits
-- the historical UNIQUE (account_id, kind) constraint (an archived thread still
-- occupies the slot), the latest thread is revived instead — replying to a
-- brief must never dead-end.
CREATE OR REPLACE FUNCTION admin_get_or_create_thread(p_account_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread uuid;
BEGIN
  IF NOT is_admin_jwt() THEN RAISE EXCEPTION 'not authorized'; END IF;

  SELECT id INTO v_thread
  FROM threads
  WHERE account_id = p_account_id
    AND kind = 'oncall'
    AND archived_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_thread IS NOT NULL THEN RETURN v_thread; END IF;

  BEGIN
    INSERT INTO threads (account_id, kind)
    VALUES (p_account_id, 'oncall')
    RETURNING id INTO v_thread;
  EXCEPTION WHEN unique_violation THEN
    UPDATE threads
    SET archived_at = NULL
    WHERE id = (
      SELECT id FROM threads
      WHERE account_id = p_account_id AND kind = 'oncall'
      ORDER BY created_at DESC
      LIMIT 1
    )
    RETURNING id INTO v_thread;
  END;

  RETURN v_thread;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_get_or_create_thread(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_get_or_create_thread(uuid) TO authenticated, service_role;
