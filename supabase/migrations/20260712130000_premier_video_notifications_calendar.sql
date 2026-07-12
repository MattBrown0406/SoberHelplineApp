-- Premier video operational notifications, reminders, and calendar dispatch.
-- Push rows are idempotent and may carry safe deep-link metadata.

ALTER TABLE push_outbox
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_token uuid;

CREATE INDEX IF NOT EXISTS push_outbox_due_unsent_idx
  ON push_outbox (scheduled_for, created_at)
  WHERE sent_at IS NULL AND failed_at IS NULL;

CREATE OR REPLACE FUNCTION claim_push_outbox(p_limit integer DEFAULT 200, p_lease interval DEFAULT interval '5 minutes')
RETURNS SETOF push_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_token uuid:=gen_random_uuid();
BEGIN
  IF p_limit NOT BETWEEN 1 AND 500 OR p_lease < interval '30 seconds' OR p_lease > interval '30 minutes' THEN RAISE EXCEPTION 'invalid_claim_parameters'; END IF;
  RETURN QUERY WITH claimed AS (
    SELECT id FROM push_outbox WHERE sent_at IS NULL AND failed_at IS NULL AND scheduled_for<=now()
      AND (processing_at IS NULL OR processing_at < now()-p_lease)
    ORDER BY scheduled_for,created_at FOR UPDATE SKIP LOCKED LIMIT p_limit
  ) UPDATE push_outbox o SET processing_at=now(),processing_token=v_token
    FROM claimed WHERE o.id=claimed.id RETURNING o.*;
END $$;
REVOKE ALL ON FUNCTION claim_push_outbox(integer,interval) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION claim_push_outbox(integer,interval) TO service_role;

-- Enqueue 24-hour and 1-hour reminders for the member and assigned coach.
-- Safe to run repeatedly: push_outbox.idempotency_key prevents duplicates.
CREATE OR REPLACE FUNCTION enqueue_premier_video_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session video_sessions;
  v_target uuid;
  v_window text;
  v_count integer := 0;
  v_when text;
BEGIN
  FOR v_session IN
    SELECT s.*
    FROM video_sessions s
    WHERE s.status = 'scheduled'
      AND s.scheduled_for IS NOT NULL
      AND s.assigned_coach_id IS NOT NULL
      AND s.scheduled_for > now()
      AND (
        s.scheduled_for BETWEEN now() + interval '23 hours 55 minutes' AND now() + interval '24 hours 5 minutes'
        OR s.scheduled_for BETWEEN now() + interval '55 minutes' AND now() + interval '65 minutes'
      )
  LOOP
    v_window := CASE
      WHEN v_session.scheduled_for > now() + interval '2 hours' THEN '24h'
      ELSE '1h'
    END;
    v_when := to_char(v_session.scheduled_for AT TIME ZONE v_session.requested_timezone, 'FMDy, FMMon FMDD at FMHH12:MI AM');

    FOREACH v_target IN ARRAY ARRAY[v_session.account_id, v_session.assigned_coach_id]
    LOOP
      INSERT INTO push_outbox(account_id, kind, title, body, metadata, idempotency_key, scheduled_for)
      VALUES (
        v_target,
        CASE WHEN v_target = v_session.account_id THEN 'premier_video_reminder' ELSE 'coach_video_reminder' END,
        CASE WHEN v_window = '24h' THEN 'Premier video session tomorrow' ELSE 'Premier video session in one hour' END,
        'Your Premier video session is ' || CASE WHEN v_window = '24h' THEN 'tomorrow, ' ELSE 'in about one hour, ' END || v_when || ' (' || v_session.requested_timezone || ').',
        jsonb_build_object(
          'kind', CASE WHEN v_target = v_session.account_id THEN 'premier_video_reminder' ELSE 'coach_video_reminder' END,
          'session_id', v_session.id,
          'event', 'reminder_' || v_window,
          'screen', CASE WHEN v_target = v_session.account_id THEN 'support' ELSE 'admin' END
        ),
        'video:' || v_session.id::text || ':' || v_session.version::text || ':reminder:' || v_window || ':' || v_target::text,
        now()
      )
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
      IF FOUND THEN v_count := v_count + 1; END IF;
    END LOOP;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION enqueue_premier_video_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION enqueue_premier_video_reminders() TO service_role;

-- The calendar Edge Function owns OAuth and writes synced/failed state back to
-- video_sessions. Dispatch atomically leases work; callbacks must match both the
-- session version and unguessable lease token.
ALTER TABLE video_sessions
  ADD COLUMN IF NOT EXISTS calendar_lease_token uuid,
  ADD COLUMN IF NOT EXISTS calendar_lease_version integer,
  ADD COLUMN IF NOT EXISTS calendar_lease_expires_at timestamptz;
ALTER TABLE video_sessions DROP CONSTRAINT video_sessions_calendar_sync_check;
ALTER TABLE video_sessions ADD CONSTRAINT video_sessions_calendar_sync_check
  CHECK (calendar_sync_status IN ('not_synced','pending','processing','synced','failed','cancelled'));
CREATE OR REPLACE FUNCTION dispatch_pending_video_calendar_sync()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session record;
  v_count integer := 0;
  v_url text := 'https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/sync-video-session-calendar';
  v_service_key text;
BEGIN
  SELECT decrypted_secret INTO v_service_key
  FROM vault.decrypted_secrets
  WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'
  LIMIT 1;

  IF v_service_key IS NULL THEN
    RAISE WARNING 'SUPABASE_SERVICE_ROLE_KEY missing from vault; calendar sync skipped';
    RETURN 0;
  END IF;

  FOR v_session IN
    WITH candidates AS (
      SELECT id FROM video_sessions
      WHERE calendar_sync_status='pending'
         OR (calendar_sync_status='processing' AND calendar_lease_expires_at<now())
      ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 20
    )
    UPDATE video_sessions s SET calendar_sync_status='processing',calendar_lease_token=gen_random_uuid(),
      calendar_lease_version=s.version,calendar_lease_expires_at=now()+interval '5 minutes'
    FROM candidates WHERE s.id=candidates.id
    RETURNING s.id,s.status,s.version,s.calendar_lease_token
  LOOP
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object('sessionId',v_session.id,'version',v_session.version,'leaseToken',v_session.calendar_lease_token)
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION dispatch_pending_video_calendar_sync() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION dispatch_pending_video_calendar_sync() TO service_role;

-- pg_cron already exists in this project. Replace jobs idempotently by name.
DO $$
DECLARE v_job bigint;
BEGIN
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'shl-premier-video-reminders' LIMIT 1;
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'shl-premier-video-calendar-sync' LIMIT 1;
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
END $$;

SELECT cron.schedule(
  'shl-premier-video-reminders',
  '*/5 * * * *',
  $$SELECT public.enqueue_premier_video_reminders()$$
);

SELECT cron.schedule(
  'shl-premier-video-calendar-sync',
  '*/2 * * * *',
  $$SELECT public.dispatch_pending_video_calendar_sync()$$
);
