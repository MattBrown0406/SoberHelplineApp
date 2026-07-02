-- =============================================================================
-- Lock down push-target RPCs: they return members' Expo push tokens and are
-- only ever called by the send-engagement-push edge function (service role).
-- Without this, any authenticated (or anon) client could harvest push tokens.
-- =============================================================================

REVOKE EXECUTE ON FUNCTION get_session_reminder_targets(text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION get_winback_push_targets() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION mark_winback_sent(uuid[]) FROM anon, authenticated, public;

-- Older token RPC (kept for compatibility) gets the same treatment.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_session_rsvp_push_tokens') THEN
    REVOKE EXECUTE ON FUNCTION get_session_rsvp_push_tokens(text) FROM anon, authenticated, public;
  END IF;
END;
$$;
