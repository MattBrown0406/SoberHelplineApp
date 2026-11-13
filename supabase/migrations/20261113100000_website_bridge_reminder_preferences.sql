-- Website bridge, Contract D addition: what members told the app about Monday
-- call reminders, so soberhelpline.com can respect it.
--
-- Until now the website only asked "does the app remind her by push?"
-- (service_family_squares_push_reachable). Two answers it never heard:
--   - she turned the Monday call reminder OFF in the app. The website then saw
--     "not reminded by the app" and started emailing her reminders instead.
--   - she answered "can't make it" for this week's call. The website kept
--     reminding her about a meeting she had already declined.
--
-- This adds one read-only lookup. It changes no table and no existing function.
-- The website decides what to do with the answer and fails open if the call
-- fails, exactly as it does for push-reachable.

CREATE OR REPLACE FUNCTION public.service_family_squares_reminder_preferences(p_emails text[], p_since timestamptz)
RETURNS TABLE(email text, reminders_off boolean, declined boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- NULL when no Family Squares session exists: then nobody counts as declined.
  v_session uuid := public.family_squares_session_id();
BEGIN
  IF p_since IS NULL OR NOT isfinite(p_since) THEN
    RAISE EXCEPTION 'invalid_since' USING ERRCODE = '22023';
  END IF;
  IF coalesce(cardinality(p_emails), 0) > 1000 THEN
    RAISE EXCEPTION 'too_many_emails' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH wanted AS (
    SELECT DISTINCT lower(btrim(x)) AS email
    FROM unnest(coalesce(p_emails, ARRAY[]::text[])) AS x
    WHERE nullif(btrim(x), '') IS NOT NULL
  ),
  people AS (
    SELECT w.email, a.id AS account_id, a.user_id, a.family_call_reminders
    FROM wanted w
    JOIN auth.users u ON lower(btrim(u.email::text)) = w.email
    JOIN public.accounts a ON a.user_id = u.id
    WHERE u.email_confirmed_at IS NOT NULL
      AND u.deleted_at IS NULL
  ),
  answered AS (
    -- Her newest answer for this week's call (the same window and the same
    -- account matching as service_family_squares_attendees).
    SELECT p.email,
           (SELECT sr.status
            FROM public.session_rsvps sr
            WHERE v_session IS NOT NULL
              AND sr.session_id = v_session
              AND (sr.account_id = p.account_id OR sr.account_id = p.user_id)
              AND sr.status IN ('going', 'declined')
              AND sr.created_at > p_since
            ORDER BY sr.created_at DESC
            LIMIT 1) AS latest,
           p.family_call_reminders
    FROM people p
  )
  SELECT a.email,
         bool_or(NOT coalesce(a.family_call_reminders, true)),
         bool_or(coalesce(a.latest = 'declined', false))
  FROM answered a
  GROUP BY a.email
  -- Only people with something to say: the caller treats everyone else as before.
  HAVING bool_or(NOT coalesce(a.family_call_reminders, true))
      OR bool_or(coalesce(a.latest = 'declined', false))
  ORDER BY a.email;
END;
$$;

REVOKE ALL ON FUNCTION public.service_family_squares_reminder_preferences(text[], timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_family_squares_reminder_preferences(text[], timestamptz) TO service_role;
