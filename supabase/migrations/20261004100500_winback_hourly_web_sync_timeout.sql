-- Two cron fixes. Re-runnable.
--
-- 1. Winback is sent only 9 AM–8 PM in the member's own time zone
--    (20261004100200), but the job ran once a day at 17:00 UTC, so members
--    whose window never includes 17:00 UTC (Hawaii, Alaska in winter, Asia,
--    Australia) were never reached. Run it hourly at :05. The window check and
--    the 7-day cooldown (last_winback_at + the claimed reservation) still allow
--    at most one winback per member per week.
--
-- 2. family-squares-web-sync waits up to 10 s for the website, but pg_net's
--    default timeout is 5 s, so runs that coincide with the website's own
--    :00/:30 jobs were recorded as timeouts. Give the call 20 s.
DO $$
DECLARE
  v_job bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;

  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'shl-winback';
  IF v_job IS NOT NULL THEN
    PERFORM cron.unschedule(v_job);
  END IF;
  PERFORM cron.schedule(
    'shl-winback',
    '5 * * * *',
    $cron$
    SELECT net.http_post(
      url     := 'https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/send-engagement-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1
        )
      ),
      body    := jsonb_build_object('job', 'winback'),
      timeout_milliseconds := 20000
    );
    $cron$
  );

  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'shl-family-squares-web-sync';
  IF v_job IS NOT NULL THEN
    PERFORM cron.unschedule(v_job);
  END IF;
  PERFORM cron.schedule(
    'shl-family-squares-web-sync',
    '*/15 * * * *',
    $cron$
    SELECT net.http_post(
      url     := 'https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/family-squares-web-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1
        )
      ),
      body    := '{}'::jsonb,
      timeout_milliseconds := 20000
    );
    $cron$
  );
END $$;
