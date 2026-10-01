-- Calendar sync reliability for private video / plan-review sessions.
--
-- 1. Failed syncs were never retried and nobody saw them. The existing
--    dispatcher cron (every 2 minutes) now re-leases 'failed' rows with an
--    attempt counter and exponential backoff (the Edge Function stores
--    calendar_next_attempt_at; max 6 attempts).
-- 2. A cancel / no-show / withdrawn time with calendar_event_id NULL skipped
--    calendar work, although an earlier sync may have created the event under
--    its deterministic id (in-flight lease, failed save). The dispatcher now
--    records that deterministic id when it leases a scheduled session (so the
--    scheduling RPCs see an event id and queue the delete), and rows that were
--    in flight or failed without an id are queued for deletion too.
-- 3. Staff can see sync status in the admin video card and queue a retry.

ALTER TABLE public.video_sessions
  ADD COLUMN IF NOT EXISTS calendar_sync_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS calendar_next_attempt_at timestamptz;

ALTER TABLE public.video_sessions DROP CONSTRAINT IF EXISTS video_sessions_calendar_attempts_check;
ALTER TABLE public.video_sessions ADD CONSTRAINT video_sessions_calendar_attempts_check
  CHECK (calendar_sync_attempts BETWEEN 0 AND 1000);

CREATE INDEX IF NOT EXISTS video_sessions_calendar_retry_idx
  ON public.video_sessions (calendar_sync_status, calendar_next_attempt_at)
  WHERE calendar_sync_status IN ('pending', 'processing', 'failed');

-- Syncs that failed before retries existed: don't resurrect calendar events
-- for sessions whose time has already passed.
UPDATE public.video_sessions
SET calendar_sync_attempts = 6
WHERE calendar_sync_status = 'failed'
  AND calendar_sync_attempts = 0
  AND coalesce(scheduled_for, requested_start) < now();

-- Runs after the other BEFORE UPDATE triggers (names sort alphabetically), so
-- it also sees the refund trigger's cancellation.
CREATE OR REPLACE FUNCTION public._video_calendar_sync_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Lease handling and the function's own saves never change status/version;
  -- every scheduling change does.
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.version IS NOT DISTINCT FROM OLD.version THEN
    RETURN NEW;
  END IF;

  -- The scheduling RPCs mark calendar work 'cancelled'/'not_synced' when no
  -- event id is stored. A sync that was in flight or failed (including rows
  -- leased before the dispatcher recorded ids) may still have created the
  -- event under its deterministic id: delete it instead of skipping.
  IF NEW.status IN ('cancelled', 'no_show', 'requested')
     AND NEW.calendar_event_id IS NULL
     AND NEW.calendar_sync_status IN ('cancelled', 'not_synced')
     AND OLD.calendar_sync_status IN ('processing', 'failed') THEN
    NEW.calendar_sync_status := 'pending';
    NEW.calendar_sync_error := NULL;
  END IF;

  -- New calendar work starts a fresh retry budget.
  IF NEW.calendar_sync_status = 'pending' THEN
    NEW.calendar_sync_attempts := 0;
    NEW.calendar_next_attempt_at := NULL;
  END IF;
  RETURN NEW;
END
$$;

REVOKE EXECUTE ON FUNCTION public._video_calendar_sync_state() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_video_sessions_zz_calendar_sync_state ON public.video_sessions;
CREATE TRIGGER trg_video_sessions_zz_calendar_sync_state
  BEFORE UPDATE ON public.video_sessions
  FOR EACH ROW EXECUTE FUNCTION public._video_calendar_sync_state();

CREATE OR REPLACE FUNCTION public.dispatch_pending_video_calendar_sync()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session record;
  v_count integer := 0;
  v_max_attempts constant integer := 6;
  v_url text := 'https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/sync-video-session-calendar';
  v_service_key text;
BEGIN
  -- A sync that never reported back (function crash/timeout) after the last
  -- allowed attempt is surfaced as failed instead of looping forever.
  UPDATE video_sessions
  SET calendar_sync_status = 'failed',
      calendar_sync_error = COALESCE(calendar_sync_error, 'lease_expired: The calendar sync did not report back.'),
      calendar_lease_token = NULL,
      calendar_lease_version = NULL,
      calendar_lease_expires_at = NULL,
      calendar_next_attempt_at = NULL
  WHERE calendar_sync_status = 'processing'
    AND calendar_lease_expires_at < now()
    AND calendar_sync_attempts >= v_max_attempts;

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
      WHERE (calendar_sync_status = 'pending'
             AND (calendar_next_attempt_at IS NULL OR calendar_next_attempt_at <= now()))
         OR (calendar_sync_status = 'failed'
             AND calendar_sync_attempts < v_max_attempts
             AND (calendar_next_attempt_at IS NULL OR calendar_next_attempt_at <= now()))
         OR (calendar_sync_status = 'processing'
             AND calendar_lease_expires_at < now()
             AND calendar_sync_attempts < v_max_attempts)
      ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 20
    )
    UPDATE video_sessions s SET calendar_sync_status = 'processing',
      calendar_sync_attempts = s.calendar_sync_attempts + 1,
      -- The function creates a scheduled session's event under this id; once
      -- recorded, a later cancel/no-show/new time always queues its deletion
      -- even if the creating sync never reports back.
      calendar_event_id = CASE
        WHEN s.status = 'scheduled' AND s.calendar_event_id IS NULL
          THEN 'vsession' || replace(lower(s.id::text), '-', '')
        ELSE s.calendar_event_id END,
      calendar_next_attempt_at = NULL,
      calendar_lease_token = gen_random_uuid(),
      calendar_lease_version = s.version,
      calendar_lease_expires_at = now() + interval '5 minutes'
    FROM candidates WHERE s.id = candidates.id
    RETURNING s.id, s.status, s.version, s.calendar_lease_token
  LOOP
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body := jsonb_build_object('sessionId', v_session.id, 'version', v_session.version, 'leaseToken', v_session.calendar_lease_token)
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_pending_video_calendar_sync() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_pending_video_calendar_sync() TO service_role;

-- Owner/staff "Retry sync" from the admin video card. Does not bump the
-- session version (the member's optimistic version is untouched); the next
-- dispatcher tick (≤ 2 minutes) picks the row up.
CREATE OR REPLACE FUNCTION public.admin_retry_video_calendar_sync(p_session_id uuid)
RETURNS public.video_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.my_account_id();
  v_row public.video_sessions;
BEGIN
  IF v_actor IS NULL OR NOT public.is_video_staff(v_actor) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.video_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  IF v_row.calendar_sync_status = 'processing' AND v_row.calendar_lease_expires_at > now() THEN
    RAISE EXCEPTION 'calendar_sync_in_progress';
  END IF;
  -- Nothing was ever put on the calendar for a request that was never
  -- confirmed; a retry would only be a no-op round trip.
  IF v_row.calendar_sync_status IN ('not_synced', 'cancelled') AND v_row.calendar_event_id IS NULL
     AND v_row.status <> 'scheduled' THEN
    RAISE EXCEPTION 'nothing_to_sync';
  END IF;

  UPDATE public.video_sessions
  SET calendar_sync_status = 'pending',
      calendar_sync_error = NULL,
      calendar_sync_attempts = 0,
      calendar_next_attempt_at = NULL,
      calendar_lease_token = NULL,
      calendar_lease_version = NULL,
      calendar_lease_expires_at = NULL
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  PERFORM public._video_event(v_row, v_actor, 'coach', 'calendar_sync_retry_requested', v_row.status, '{}'::jsonb);
  RETURN v_row;
END
$$;

REVOKE EXECUTE ON FUNCTION public.admin_retry_video_calendar_sync(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_retry_video_calendar_sync(uuid) TO authenticated, service_role;
