-- =============================================================================
-- FIX: admin Zoom link (and RSVPs / questions / reminders) silently broken.
--
-- BUG: The production sessions row is titled 'The Family Squares', but every
-- admin RPC filtered WHERE title = 'Monday Night Family Support'. UPDATE with
-- no matching row "succeeds" affecting 0 rows, so saving the Zoom link looked
-- fine in the dashboard (local state) but never persisted; the RSVP and
-- question lists queried a nonexistent session and returned empty.
--
-- FIX: resolve the session by a tolerant helper (matches either title) and
-- RAISE when it can't be found, so a future rename fails loudly instead of
-- silently.
-- =============================================================================

CREATE OR REPLACE FUNCTION family_squares_session_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM sessions
  WHERE title IN ('The Family Squares', 'Monday Night Family Support')
  ORDER BY created_at ASC
  LIMIT 1
$$;

-- ─── Zoom link save: target the real row, fail loudly if missing ─────────────
CREATE OR REPLACE FUNCTION admin_update_family_squares_zoom_url(p_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (auth.jwt() ->> 'email') IS DISTINCT FROM 'matt@soberhelpline.com' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE sessions SET zoom_url = p_url WHERE id = family_squares_session_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Family Squares session row not found — zoom link NOT saved';
  END IF;
END;
$$;

-- ─── RSVP list ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_get_family_squares_rsvps()
RETURNS TABLE(first_name text, last_name text, email text, rsvped_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (auth.jwt() ->> 'email') IS DISTINCT FROM 'matt@soberhelpline.com' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  SELECT a.first_name, a.last_name, u.email::text, sr.created_at
  FROM session_rsvps sr
  JOIN accounts a ON a.id  = sr.account_id
  JOIN auth.users u ON u.id = a.user_id
  WHERE sr.session_id = family_squares_session_id()
    AND sr.status = 'going'
  ORDER BY sr.created_at DESC;
END;
$$;

-- ─── Pre-submitted questions ──────────────────────────────────────────────────
-- NULL default resolves via the helper; an explicit title still works.
DROP FUNCTION IF EXISTS admin_get_session_questions(text);
CREATE FUNCTION admin_get_session_questions(p_session_title text DEFAULT NULL)
RETURNS TABLE(id uuid, first_name text, last_name text, question text, submitted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (auth.jwt() ->> 'email') IS DISTINCT FROM 'matt@soberhelpline.com' THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  SELECT sq.id, a.first_name, a.last_name, sq.question, sq.created_at
  FROM session_questions sq
  JOIN accounts a ON a.id = sq.account_id
  WHERE sq.session_id = CASE
    WHEN p_session_title IS NULL THEN family_squares_session_id()
    ELSE (SELECT s.id FROM sessions s WHERE s.title = p_session_title LIMIT 1)
  END
  ORDER BY sq.created_at DESC;
END;
$$;

-- ─── Push reminder targets: same tolerant resolution ──────────────────────────
DROP FUNCTION IF EXISTS get_session_reminder_targets(text);
CREATE FUNCTION get_session_reminder_targets(p_session_title text DEFAULT NULL)
RETURNS TABLE(push_token text, locale text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT a.push_token, a.locale
  FROM session_rsvps sr
  JOIN accounts a ON a.id = sr.account_id
  WHERE sr.session_id = CASE
    WHEN p_session_title IS NULL THEN family_squares_session_id()
    ELSE (SELECT s.id FROM sessions s WHERE s.title = p_session_title LIMIT 1)
  END
    AND sr.status = 'going'
    AND a.push_token IS NOT NULL;
$$;
