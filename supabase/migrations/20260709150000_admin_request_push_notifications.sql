-- =============================================================================
-- Admin push notifications for inbound requests. New private-video requests
-- and new Urgent Text Line member messages enqueue a push_outbox row for the
-- admin account; the existing send-engagement-push drain (every 5 min)
-- delivers it. Notifications are deliberately content-free — crisis-adjacent
-- text must never sit on a lock screen.
--
-- Trigger functions are SECURITY DEFINER: the inserting member has no RLS
-- access to push_outbox (service-only table).
-- =============================================================================

CREATE OR REPLACE FUNCTION admin_account_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id
  FROM accounts a
  JOIN auth.users u ON u.id = a.user_id
  WHERE lower(u.email) = 'matt@soberhelpline.com'
  LIMIT 1
$$;

-- ─── New private video request ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _notify_admin_video_request()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin uuid := admin_account_id();
BEGIN
  -- Skip self-requests (admin testing) and missing admin account.
  IF v_admin IS NOT NULL AND NEW.account_id IS DISTINCT FROM v_admin
     AND NEW.status = 'requested' THEN
    INSERT INTO push_outbox (account_id, kind, title, body)
    VALUES (
      v_admin,
      'admin_video_request',
      '🎥 New private video request',
      'A member requested a private video session. Open Admin to schedule or start it.'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admin_video_request ON video_sessions;
CREATE TRIGGER trg_notify_admin_video_request
  AFTER INSERT ON video_sessions
  FOR EACH ROW EXECUTE FUNCTION _notify_admin_video_request();

-- ─── New Urgent Text Line member message ─────────────────────────────────────
CREATE OR REPLACE FUNCTION _notify_admin_textline_message()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin uuid := admin_account_id();
  v_thread threads%ROWTYPE;
BEGIN
  IF NEW.sender_role = 'member' AND v_admin IS NOT NULL THEN
    SELECT * INTO v_thread FROM threads WHERE id = NEW.thread_id;
    IF v_thread.kind = 'oncall' AND v_thread.account_id IS DISTINCT FROM v_admin THEN
      INSERT INTO push_outbox (account_id, kind, title, body)
      VALUES (
        v_admin,
        'admin_textline_message',
        '💬 New Urgent Text Line message',
        'A member sent a new message. Open Admin to read and reply.'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_admin_textline_message ON messages;
CREATE TRIGGER trg_notify_admin_textline_message
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION _notify_admin_textline_message();
