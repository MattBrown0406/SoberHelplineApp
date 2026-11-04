BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(4);

-- Every migration-managed HTTP job sends only when the service-role key exists,
-- so copies of this database (local stacks, old replicas) stop calling
-- production without credentials.
SELECT is(
  (SELECT count(*)::int FROM cron.job
    WHERE jobname = ANY (ARRAY['shl-push-drain', 'shl-session-reminder', 'shl-family-call-30min', 'shl-winback',
      'shl-drain-spine-outbox', 'shl-family-squares-link-sync', 'shl-family-squares-web-sync',
      'daily-morning-notification', 'shl-la-sobremesa-reminder'])
      AND command LIKE '%WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = ''SUPABASE_SERVICE_ROLE_KEY'' AND decrypted_secret IS NOT NULL);'),
  9, 'all nine HTTP jobs carry the key guard');

DELETE FROM vault.secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY';
DELETE FROM net.http_request_queue;
DO $$ DECLARE c text; BEGIN SELECT command INTO c FROM cron.job WHERE jobname = 'shl-push-drain'; EXECUTE c; END $$;
SELECT is((SELECT count(*)::int FROM net.http_request_queue), 0, 'without the key, nothing is sent');

SELECT ok(vault.create_secret('pgtap-not-a-real-key', 'SUPABASE_SERVICE_ROLE_KEY') IS NOT NULL, 'key stored for the test');
DO $$ DECLARE c text; BEGIN SELECT command INTO c FROM cron.job WHERE jobname = 'shl-push-drain'; EXECUTE c; END $$;
SELECT is((SELECT count(*)::int FROM net.http_request_queue), 1, 'with the key, the job still sends');

SELECT * FROM finish();
ROLLBACK;
