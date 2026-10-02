-- The app's Family Squares Join button follows soberhelpline.com.
--
-- The website creates each week's Monday Zoom meeting and can replace tonight's,
-- publishing the current join link in its public site_settings. zoom-sync now
-- copies that link (and the next Monday 7 PM Pacific start) onto the app's
-- session row. It was never scheduled on production, so the app kept June's
-- meeting link. Every 10 minutes keeps a same-day replacement in step; an
-- unchanged link is a no-op.
DO $$
DECLARE
  v_job bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'shl-family-squares-link-sync';
  IF v_job IS NOT NULL THEN
    PERFORM cron.unschedule(v_job);
  END IF;
  PERFORM cron.schedule(
    'shl-family-squares-link-sync',
    '*/10 * * * *',
    $cron$
    SELECT net.http_post(
      url     := 'https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/zoom-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1
        )
      ),
      body    := '{}'::jsonb
    );
    $cron$
  );
END $$;
