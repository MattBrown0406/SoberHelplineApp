-- =============================================================================
-- P2.2 — Moderated peer community feed
-- Tables:  community_posts (UGC), community_reports (member reports)
-- RPCs:    create_community_post (crisis-screened), report_community_post
--          (auto-hold at threshold), moderate_community_post (admin),
--          upcoming_call_rsvp_count (anonymized belonging count from RSVPs)
-- Safety:  per docs/legal/crisis-protocol.md — at-risk disclosures are screened
--          server-side and never posted; the client routes the author to 988/911.
-- =============================================================================

-- ─── Posts ────────────────────────────────────────────────────────────────────
-- author_display is denormalized (first name, or "A family member") so the feed
-- never needs to read other accounts' rows (accounts SELECT is owner-only).
CREATE TABLE community_posts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  author_display text       NOT NULL DEFAULT 'A family member',
  body          text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  status        text        NOT NULL DEFAULT 'visible'
                  CHECK (status IN ('visible', 'held', 'removed')),
  report_count  int         NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX community_posts_visible_idx
  ON community_posts (created_at DESC) WHERE status = 'visible';

ALTER TABLE community_posts ENABLE ROW LEVEL SECURITY;

-- Members read visible posts (plus their own, plus admin sees all). No INSERT/
-- UPDATE policy: all writes go through the SECURITY DEFINER RPCs below so crisis
-- screening and moderation can't be bypassed.
CREATE POLICY "community_posts: read" ON community_posts FOR SELECT
  USING (
    status = 'visible'
    OR account_id = my_account_id()
    OR (auth.jwt() ->> 'email') = 'matt@soberhelpline.com'
  );

-- Authors may delete their own post; admin may delete any.
CREATE POLICY "community_posts: delete" ON community_posts FOR DELETE
  USING (
    account_id = my_account_id()
    OR (auth.jwt() ->> 'email') = 'matt@soberhelpline.com'
  );

-- ─── Reports ──────────────────────────────────────────────────────────────────
CREATE TABLE community_reports (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id             uuid        NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  reporter_account_id uuid        NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reason              text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, reporter_account_id)
);

ALTER TABLE community_reports ENABLE ROW LEVEL SECURITY;

-- Reports are write-only for members (via RPC); only admin can read them.
CREATE POLICY "community_reports: admin read" ON community_reports FOR SELECT
  USING ((auth.jwt() ->> 'email') = 'matt@soberhelpline.com');

-- ─── Create post (crisis-screened) ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_community_post(p_body text)
RETURNS community_posts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := my_account_id();
  v_name    text;
  v_clean   text := btrim(p_body);
  v_lower   text := lower(p_body);
  v_post    community_posts;
BEGIN
  IF v_account IS NULL THEN RAISE EXCEPTION 'no_account'; END IF;
  IF char_length(v_clean) = 0 THEN RAISE EXCEPTION 'empty'; END IF;

  -- Crisis screening: an at-risk disclosure must never be posted to a peer feed.
  -- We refuse it and the client routes the author to 988/911 + their coach.
  IF v_lower ~ '(kill myself|killing myself|want to die|wanna die|end my life|end it all|suicide|suicidal|hurt myself|harm myself|overdosing|take my life|no reason to live|matarme|quitarme la vida|suicid|acabar con mi vida)' THEN
    RAISE EXCEPTION 'crisis_content';
  END IF;

  SELECT first_name INTO v_name FROM accounts WHERE id = v_account;

  INSERT INTO community_posts (account_id, author_display, body)
  VALUES (
    v_account,
    coalesce(nullif(btrim(v_name), ''), 'A family member'),
    left(v_clean, 500)
  )
  RETURNING * INTO v_post;

  RETURN v_post;
END;
$$;

-- ─── Report post (auto-hold at threshold) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION report_community_post(p_post_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := my_account_id();
  v_count   int;
BEGIN
  IF v_account IS NULL THEN RAISE EXCEPTION 'no_account'; END IF;

  INSERT INTO community_reports (post_id, reporter_account_id, reason)
  VALUES (p_post_id, v_account, nullif(btrim(p_reason), ''))
  ON CONFLICT (post_id, reporter_account_id) DO NOTHING;

  UPDATE community_posts
  SET report_count = (SELECT count(*) FROM community_reports WHERE post_id = p_post_id)
  WHERE id = p_post_id
  RETURNING report_count INTO v_count;

  -- Hold the post pending admin review once enough members flag it.
  IF v_count >= 3 THEN
    UPDATE community_posts SET status = 'held'
    WHERE id = p_post_id AND status = 'visible';
  END IF;
END;
$$;

-- ─── Admin moderation ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION moderate_community_post(p_post_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (auth.jwt() ->> 'email') <> 'matt@soberhelpline.com' THEN
    RAISE EXCEPTION 'not_admin';
  END IF;
  IF p_status NOT IN ('visible', 'held', 'removed') THEN
    RAISE EXCEPTION 'bad_status';
  END IF;
  UPDATE community_posts SET status = p_status WHERE id = p_post_id;
END;
$$;

-- ─── Belonging count (anonymized, seeded from session_rsvps) ───────────────────
-- RLS on session_rsvps is owner-only, so members can't count each other. This
-- returns just an aggregate count + label for the next group call — no identities.
CREATE OR REPLACE FUNCTION upcoming_call_rsvp_count()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session sessions;
  v_count   int;
BEGIN
  SELECT * INTO v_session FROM sessions
   WHERE kind = 'group' AND (next_at IS NULL OR next_at >= now())
   ORDER BY next_at ASC NULLS LAST
   LIMIT 1;

  IF NOT FOUND THEN
    SELECT * INTO v_session FROM sessions
     WHERE kind = 'group'
     ORDER BY next_at DESC NULLS LAST
     LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('count', 0, 'schedule_label', NULL);
  END IF;

  SELECT count(*) INTO v_count
  FROM session_rsvps
  WHERE session_id = v_session.id AND status = 'going';

  RETURN jsonb_build_object('count', v_count, 'schedule_label', v_session.schedule_label);
END;
$$;
