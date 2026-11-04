-- Copies of this database (a developer's local stack, old replicas on other
-- servers) run these same cron jobs against the production function URLs.
-- Without the service-role key in their vault, 'Bearer ' || NULL drops the
-- Authorization header and every call is a 401 — thousands a day, noise that
-- can hide a real failure. Production has the key, so nothing changes there.
--
-- Each migration-managed HTTP job becomes "send only when the key exists":
-- the existing command is kept verbatim (URL, body, timeout) and gains
--   WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets
--                 WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' AND decrypted_secret IS NOT NULL)
-- Jobs are changed in place with cron.alter_job (never re-scheduled), by name,
-- only when the command has the expected single-statement shape. A later
-- migration that re-schedules one of these jobs must keep the guard.
DO $$
DECLARE
  v_job record;
  v_guard constant text :=
    ' WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = ''SUPABASE_SERVICE_ROLE_KEY'' AND decrypted_secret IS NOT NULL);';
  v_body text;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;
  FOR v_job IN
    SELECT jobid, jobname, command
    FROM cron.job
    WHERE jobname = ANY (ARRAY[
      'shl-push-drain', 'shl-session-reminder', 'shl-family-call-30min', 'shl-winback',
      'shl-drain-spine-outbox', 'shl-family-squares-link-sync', 'shl-family-squares-web-sync',
      'daily-morning-notification', 'shl-la-sobremesa-reminder'
    ])
  LOOP
    -- Already guarded, or not the shape this rewrite understands: leave it.
    CONTINUE WHEN position('WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets' IN v_job.command) > 0;
    CONTINUE WHEN v_job.command !~* '^\s*SELECT\s+net\.http_post\(';
    CONTINUE WHEN position('SUPABASE_SERVICE_ROLE_KEY' IN v_job.command) = 0;
    v_body := regexp_replace(v_job.command, '\s*;\s*$', '');
    CONTINUE WHEN v_body !~ '\)$';
    PERFORM cron.alter_job(v_job.jobid, command := v_body || v_guard);
  END LOOP;
END
$$;
