-- =============================================================================
-- P3.1 — Bilingual push: store each account's app language and localize the
-- three engagement pushes (community support, session reminder, win-back).
-- The app writes `locale` alongside the push token at registration.
-- =============================================================================

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en';

-- ─── Community support: queue the author-locale copy ────────────────────────
CREATE OR REPLACE FUNCTION support_community_post(p_post_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := my_account_id();
  v_author  uuid;
  v_locale  text;
  v_count   int;
  v_inserted boolean := false;
BEGIN
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT account_id INTO v_author
  FROM community_posts
  WHERE id = p_post_id AND status = 'visible';
  IF v_author IS NULL THEN
    RAISE EXCEPTION 'post_not_found';
  END IF;

  INSERT INTO community_supports (post_id, supporter_account_id)
  VALUES (p_post_id, v_account)
  ON CONFLICT DO NOTHING;
  v_inserted := FOUND;

  IF v_inserted THEN
    UPDATE community_posts
    SET support_count = support_count + 1
    WHERE id = p_post_id
    RETURNING support_count INTO v_count;

    IF v_author <> v_account THEN
      SELECT locale INTO v_locale FROM accounts WHERE id = v_author;
      IF v_locale LIKE 'es%' THEN
        INSERT INTO push_outbox (account_id, kind, title, body)
        VALUES (
          v_author,
          'community_support',
          'Alguien te envió apoyo 💙',
          'Una familia respondió a tu publicación en la comunidad. No estás sola en esto.'
        );
      ELSE
        INSERT INTO push_outbox (account_id, kind, title, body)
        VALUES (
          v_author,
          'community_support',
          'Someone sent you support 💙',
          'A family member responded to your post in the community. You are not alone in this.'
        );
      END IF;
    END IF;
  ELSE
    SELECT support_count INTO v_count FROM community_posts WHERE id = p_post_id;
  END IF;

  RETURN v_count;
END;
$$;

-- ─── Win-back targets now carry the locale ───────────────────────────────────
DROP FUNCTION IF EXISTS get_winback_push_targets();
CREATE FUNCTION get_winback_push_targets()
RETURNS TABLE(account_id uuid, first_name text, push_token text, locale text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id, a.first_name, a.push_token, a.locale
  FROM accounts a
  WHERE a.push_token IS NOT NULL
    AND a.created_at < now() - interval '5 days'
    AND (a.last_winback_at IS NULL OR a.last_winback_at < now() - interval '7 days')
    AND NOT EXISTS (
      SELECT 1 FROM checkins c
      WHERE c.account_id = a.id
        AND c.created_at > now() - interval '5 days'
    );
$$;

-- ─── Session reminder targets with locale (keeps the original RPC intact) ────
CREATE OR REPLACE FUNCTION get_session_reminder_targets(p_session_title text)
RETURNS TABLE(push_token text, locale text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.push_token, a.locale
  FROM session_rsvps sr
  JOIN sessions s ON s.id = sr.session_id
  JOIN accounts a ON a.id = sr.account_id
  WHERE s.title = p_session_title
    AND sr.status = 'going'
    AND a.push_token IS NOT NULL;
$$;
