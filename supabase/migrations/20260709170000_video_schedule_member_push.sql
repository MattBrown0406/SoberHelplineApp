-- =============================================================================
-- Private video scheduling: notify the MEMBER when their session is scheduled
-- (localized, in their timezone) or goes live. Completes the loop — until now
-- nothing told a member their request had been accepted.
-- Also: cancel the reviewer-account test video rows and delete [TEST] messages
-- left by notification verification.
-- =============================================================================

CREATE OR REPLACE FUNCTION _notify_member_video_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin  uuid := admin_account_id();
  v_locale text;
  v_tz     text;
  v_when   text;
BEGIN
  -- Never notify the admin about their own test sessions.
  IF NEW.account_id IS NULL OR NEW.account_id = v_admin THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(a.locale, 'en'), COALESCE(NULLIF(a.timezone, ''), 'America/Los_Angeles')
  INTO v_locale, v_tz
  FROM accounts a WHERE a.id = NEW.account_id;

  -- Scheduled (or reschedule): tell the member when.
  IF NEW.status = 'scheduled' AND NEW.scheduled_for IS NOT NULL
     AND (OLD.status IS DISTINCT FROM 'scheduled' OR OLD.scheduled_for IS DISTINCT FROM NEW.scheduled_for) THEN
    IF v_locale LIKE 'es%' THEN
      v_when := to_char(NEW.scheduled_for AT TIME ZONE v_tz, 'FMDD/FMMM · FMHH24:MI');
      INSERT INTO push_outbox (account_id, kind, title, body)
      VALUES (NEW.account_id, 'member_video_scheduled', '🎥 Sesión de video programada',
              'Tu sesión privada de video quedó programada para el ' || v_when || '. Abre Sober Helpline para verla.');
    ELSE
      v_when := to_char(NEW.scheduled_for AT TIME ZONE v_tz, 'FMDy, FMMon FMDD · FMHH12:MI AM');
      INSERT INTO push_outbox (account_id, kind, title, body)
      VALUES (NEW.account_id, 'member_video_scheduled', '🎥 Video session scheduled',
              'Your private video session is scheduled for ' || v_when || '. Open Sober Helpline to view it.');
    END IF;
  END IF;

  -- Live: tell the member to join now.
  IF NEW.status = 'live' AND OLD.status IS DISTINCT FROM 'live' THEN
    IF v_locale LIKE 'es%' THEN
      INSERT INTO push_outbox (account_id, kind, title, body)
      VALUES (NEW.account_id, 'member_video_live', '🎥 Tu sesión de video está comenzando',
              'Abre Sober Helpline y toca "Unirse al video privado" para entrar ahora.');
    ELSE
      INSERT INTO push_outbox (account_id, kind, title, body)
      VALUES (NEW.account_id, 'member_video_live', '🎥 Your video session is starting',
              'Open Sober Helpline and tap "Join private video" to enter now.');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_member_video_update ON video_sessions;
CREATE TRIGGER trg_notify_member_video_update
  AFTER UPDATE ON video_sessions
  FOR EACH ROW EXECUTE FUNCTION _notify_member_video_update();

-- ─── Clean up notification-verification test artifacts ───────────────────────
DO $$
DECLARE
  v_reviewer uuid;
BEGIN
  SELECT a.id INTO v_reviewer
  FROM accounts a JOIN auth.users u ON u.id = a.user_id
  WHERE lower(u.email) = 'reviewer@soberhelplineapp.com';

  IF v_reviewer IS NOT NULL THEN
    UPDATE video_sessions SET status = 'cancelled'
    WHERE account_id = v_reviewer AND status IN ('requested', 'scheduled', 'live');

    DELETE FROM messages
    WHERE body LIKE '[TEST%'
      AND thread_id IN (SELECT id FROM threads WHERE account_id = v_reviewer);
  END IF;
END $$;
