-- Returns push tokens for all accounts RSVPed 'going' to a named session.
CREATE OR REPLACE FUNCTION get_session_rsvp_push_tokens(p_session_title text)
RETURNS TABLE(push_token text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT a.push_token
  FROM session_rsvps sr
  JOIN sessions s  ON s.id  = sr.session_id
  JOIN accounts a  ON a.id  = sr.account_id
  WHERE s.title        = p_session_title
    AND sr.status      = 'going'
    AND a.push_token IS NOT NULL;
$$;
