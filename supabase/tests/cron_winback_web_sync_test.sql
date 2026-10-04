BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(6);

SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'shl-winback'),
  '5 * * * *',
  'winback runs hourly so every time zone gets a 9 AM–8 PM window'
);
SELECT ok(
  (SELECT command LIKE '%send-engagement-push%' AND command LIKE '%''job'', ''winback''%'
     AND command LIKE '%vault.decrypted_secrets%' FROM cron.job WHERE jobname = 'shl-winback'),
  'winback calls send-engagement-push with the vault key'
);
SELECT ok(
  (SELECT command LIKE '%timeout_milliseconds := 20000%' FROM cron.job WHERE jobname = 'shl-family-squares-web-sync'),
  'website sync waits longer than the function''s 10 s website timeout'
);
SELECT is(
  (SELECT count(*)::int FROM cron.job WHERE jobname IN ('shl-winback', 'shl-family-squares-web-sync')),
  2,
  'each job exists exactly once'
);

SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'daily-morning-notification'),
  '0 * * * *',
  'the morning note runs hourly and reaches each member at 9 AM her time'
);
SELECT ok(
  (SELECT command LIKE '%notify-daily-morning%' AND command LIKE '%"mode":"local"%'
     AND command LIKE '%vault.decrypted_secrets%' FROM cron.job WHERE jobname = 'daily-morning-notification'),
  'the hourly call asks for local-time mode with the vault key'
);

SELECT * FROM finish();
ROLLBACK;
