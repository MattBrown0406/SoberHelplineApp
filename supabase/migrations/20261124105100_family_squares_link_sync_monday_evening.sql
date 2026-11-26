-- Family Squares link sync: every 2 minutes on Monday evenings.
--
-- shl-family-squares-link-sync (20261002130000) copies the website's Monday Zoom link onto the
-- app's session row every 10 minutes. When the website replaces tonight's meeting close to the
-- call, a member could tap Join on the old link for up to 10 minutes. This adds a second job
-- that runs the same zoom-sync call every 2 minutes on Monday evenings, Pacific time:
-- '*/2 0-4 * * 2' (pg_cron runs in UTC; Tuesday 00:00-04:58 UTC is Monday 4:00-8:58 PM PST in
-- winter and 5:00-9:58 PM PDT in summer, so it covers the evening call in both). The 10-minute
-- job is unchanged. zoom-sync is idempotent (an unchanged link is a
-- no-op), so the two jobs firing in the same minute is harmless.
--
-- Same command as the 10-minute job, with the key guard from 20261105130000 (a copy of this
-- database without the service-role key in its vault sends nothing). No key is in this file.
DO $$
DECLARE
  v_job bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'shl-family-squares-link-sync-monday';
  IF v_job IS NOT NULL THEN
    PERFORM cron.unschedule(v_job);
  END IF;
  PERFORM cron.schedule(
    'shl-family-squares-link-sync-monday',
    '*/2 0-4 * * 2',
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
    ) WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' AND decrypted_secret IS NOT NULL);$cron$
  );
END $$;
