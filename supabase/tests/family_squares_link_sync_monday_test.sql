BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(4);

-- Monday evenings the website link is copied every 2 minutes, next to the 10-minute job.
SELECT is((SELECT schedule FROM cron.job WHERE jobname = 'shl-family-squares-link-sync-monday'),
  '*/2 0-4 * * 2', 'every 2 minutes, Tuesday 00:00-04:59 UTC (Monday 5-9 PM Pacific)');
SELECT is((SELECT schedule FROM cron.job WHERE jobname = 'shl-family-squares-link-sync'),
  '*/10 * * * *', 'the 10-minute job is unchanged');
SELECT ok((SELECT command LIKE '%/functions/v1/zoom-sync%' FROM cron.job WHERE jobname = 'shl-family-squares-link-sync-monday'),
  'it calls zoom-sync');
-- Same key guard as 20261105130000: a copy without the key sends nothing.
SELECT ok((SELECT command LIKE '%WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = ''SUPABASE_SERVICE_ROLE_KEY'' AND decrypted_secret IS NOT NULL);'
  FROM cron.job WHERE jobname = 'shl-family-squares-link-sync-monday'), 'it carries the key guard');

SELECT * FROM finish();
ROLLBACK;
