-- The morning note reaches each member at 9 AM her own time.
--
-- notify-daily-morning ran once a day at 16:00 UTC (dashboard cron
-- 'daily-morning-notification'), so members outside the Americas got it in
-- the evening or at night (since 20261004 the function skips them instead).
-- The function now also accepts {"mode":"local"}: called hourly, it sends to
-- the members for whom it is 9 AM. This must land AFTER that function version
-- is deployed — the old function, called hourly, would push every opted-in
-- member every hour. Re-runnable.
DO $$
DECLARE
  v_job bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;

  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'daily-morning-notification';
  IF v_job IS NOT NULL THEN
    PERFORM cron.unschedule(v_job);
  END IF;
  PERFORM cron.schedule(
    'daily-morning-notification',
    '0 * * * *',
    $cron$
    SELECT net.http_post(
      url     := 'https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/notify-daily-morning',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1
        )
      ),
      body    := '{"mode":"local"}'::jsonb,
      timeout_milliseconds := 20000
    );
    $cron$
  );
END $$;
