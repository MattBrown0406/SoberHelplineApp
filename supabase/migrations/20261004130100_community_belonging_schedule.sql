-- The community "N families are joining …" line showed the session's English
-- schedule_label to Spanish members. Also return the session's title and
-- next_at so the app can show the Family Squares time localized and in her
-- own time zone (as Support and Today do). Additive: older app versions read
-- only count and schedule_label. Re-runnable.
CREATE OR REPLACE FUNCTION public.upcoming_call_rsvp_count()
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
    RETURN jsonb_build_object('count', 0, 'schedule_label', NULL, 'title', NULL, 'next_at', NULL);
  END IF;

  SELECT count(*) INTO v_count
  FROM session_rsvps
  WHERE session_id = v_session.id AND status = 'going';

  RETURN jsonb_build_object(
    'count', v_count,
    'schedule_label', v_session.schedule_label,
    'title', v_session.title,
    'next_at', v_session.next_at
  );
END;
$$;
