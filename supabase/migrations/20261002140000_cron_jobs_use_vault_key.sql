-- The two dashboard-made cron jobs carried a hard-coded service key that no
-- longer matches the key Edge Functions check (SUPABASE_SERVICE_ROLE_KEY is now
-- the project's sb_secret_ "default" key), so every run was rejected with 401.
-- Point them at the vault secret every other job uses. Re-runnable.
DO $$
DECLARE
  v_job bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;

  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'daily-morning-notification';
  IF v_job IS NOT NULL THEN
    PERFORM cron.alter_job(v_job, command := $cmd$
    SELECT net.http_post(
      url     := 'https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/notify-daily-morning',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1
        )
      ),
      body    := '{}'::jsonb
    );
    $cmd$);
  END IF;

  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'family-squares-reminder';
  IF v_job IS NOT NULL THEN
    PERFORM cron.alter_job(v_job, command := $cmd$
    SELECT net.http_post(
      url     := 'https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/notify-session-reminder',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1
        )
      ),
      body    := '{}'::jsonb
    );
    $cmd$);
  END IF;
END $$;
