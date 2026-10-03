-- soberhelpline.com ↔ app bridge (server to server, MEMBERSHIP_SYNC_SECRET).
--
-- C. family-squares-web-sync (cron, every 15 minutes) sends the website the
--    complete set of app members who RSVP'd to / asked a question for the next
--    Monday Family Squares call: service_family_squares_attendees.
-- D. family-squares-push-reachable tells the website which of its reminder
--    recipients the app already reminds by push: service_family_squares_push_reachable.
-- E. membership-export / membership-import replace the website's direct reads
--    and writes of this database with its service-role key:
--    service_membership_export / service_membership_import.
--
-- Only verified login emails (auth.users.email_confirmed_at set, not deleted)
-- cross, compared lower-cased and trimmed. All functions are service-role only.
-- Re-runnable.

-- ── C. Monday call RSVPs and questions ───────────────────────────────────────
-- p_since: when the previous call ended (Monday 8:00 PM Pacific); RSVPs and
-- questions before it belong to an earlier call (RSVPs reset Tuesday 2 AM).
CREATE OR REPLACE FUNCTION public.service_family_squares_attendees(p_since timestamptz)
RETURNS TABLE(email text, name text, rsvp text, questions text[], app_reminders boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session uuid := public.family_squares_session_id();
BEGIN
  IF p_since IS NULL OR NOT isfinite(p_since) THEN
    RAISE EXCEPTION 'invalid_since' USING ERRCODE = '22023';
  END IF;
  IF v_session IS NULL THEN
    RAISE EXCEPTION 'no_family_squares_session' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  WITH rsvp AS (
    -- session_rsvps.account_id is accounts.id (foreign key). Matching a row
    -- written with the auth user id as well costs nothing and loses nobody.
    SELECT DISTINCT ON (a.id) a.id AS account_id, sr.status
    FROM public.session_rsvps sr
    JOIN public.accounts a ON a.id = sr.account_id OR a.user_id = sr.account_id
    WHERE sr.session_id = v_session
      AND sr.status IN ('going', 'declined')
      AND sr.created_at > p_since
    ORDER BY a.id, sr.created_at DESC
  ),
  asked AS (
    -- The newest five questions per person, oldest first (newest last).
    SELECT q.account_id, array_agg(q.text ORDER BY q.created_at, q.id) AS questions
    FROM (
      SELECT sq.account_id, sq.id, sq.created_at,
             left(btrim(sq.question, E' \t\r\n'), 500) AS text,
             row_number() OVER (PARTITION BY sq.account_id ORDER BY sq.created_at DESC, sq.id DESC) AS n
      FROM public.session_questions sq
      WHERE sq.session_id = v_session
        AND sq.created_at > p_since
        AND btrim(sq.question, E' \t\r\n') <> ''
    ) q
    WHERE q.n <= 5
    GROUP BY q.account_id
  ),
  people AS (
    SELECT r.account_id FROM rsvp r
    UNION
    SELECT k.account_id FROM asked k
  )
  SELECT lower(btrim(u.email::text)),
         coalesce(left(nullif(btrim(a.first_name), ''), 100), 'Sober Helpline app member'),
         r.status,
         coalesce(k.questions, ARRAY[]::text[]),
         -- The app reminds them by push: a device, and an RSVP or the call reminder on.
         (nullif(btrim(a.push_token), '') IS NOT NULL AND (r.status IS NOT NULL OR a.family_call_reminders))
  FROM people p
  JOIN public.accounts a ON a.id = p.account_id
  JOIN auth.users u ON u.id = a.user_id
  LEFT JOIN rsvp r ON r.account_id = a.id
  LEFT JOIN asked k ON k.account_id = a.id
  WHERE u.email_confirmed_at IS NOT NULL
    AND u.deleted_at IS NULL
    AND nullif(btrim(u.email::text), '') IS NOT NULL
  ORDER BY 1
  -- One past the website's 2000 cap, so the caller can refuse a truncated set.
  LIMIT 2001;
END;
$$;

REVOKE ALL ON FUNCTION public.service_family_squares_attendees(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_family_squares_attendees(timestamptz) TO service_role;

-- ── D. Who the app already reminds for this week's call ──────────────────────
-- The lower-cased input emails of verified app accounts with a push token and
-- either the call reminder on or a going/declined RSVP for this week's call
-- (declined people told the app they're not coming).
CREATE OR REPLACE FUNCTION public.service_family_squares_push_reachable(p_emails text[], p_since timestamptz)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session uuid := public.family_squares_session_id();
  v_result text[];
BEGIN
  IF p_since IS NULL OR NOT isfinite(p_since) THEN
    RAISE EXCEPTION 'invalid_since' USING ERRCODE = '22023';
  END IF;
  IF coalesce(cardinality(p_emails), 0) > 1000 THEN
    RAISE EXCEPTION 'too_many_emails' USING ERRCODE = '22023';
  END IF;

  WITH wanted AS (
    SELECT DISTINCT lower(btrim(x)) AS email
    FROM unnest(coalesce(p_emails, ARRAY[]::text[])) AS x
    WHERE nullif(btrim(x), '') IS NOT NULL
  )
  SELECT coalesce(array_agg(DISTINCT w.email ORDER BY w.email), ARRAY[]::text[])
    INTO v_result
  FROM wanted w
  JOIN auth.users u ON lower(btrim(u.email::text)) = w.email
  JOIN public.accounts a ON a.user_id = u.id
  WHERE u.email_confirmed_at IS NOT NULL
    AND u.deleted_at IS NULL
    AND nullif(btrim(a.push_token), '') IS NOT NULL
    AND (
      a.family_call_reminders
      OR EXISTS (
        SELECT 1 FROM public.session_rsvps sr
        WHERE (sr.account_id = a.id OR sr.account_id = a.user_id)
          AND sr.session_id = v_session
          AND sr.status IN ('going', 'declined')
          AND sr.created_at > p_since
      )
    );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.service_family_squares_push_reachable(text[], timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_family_squares_push_reachable(text[], timestamptz) TO service_role;

-- ── E1. App memberships for the website ──────────────────────────────────────
-- Every verified account with an active app-origin paid entitlement (essential /
-- premium / org, unexpired), never one the website granted (source 'web', or
-- raw.granted_by = the website marker) — otherwise web and app grants would keep
-- each other alive. One row per account: the best tier (premium > org >
-- essential, premium reported as 'premier') and the latest expiry across its
-- qualifying rows (NULL = no expiry wins). Keyset-paged by account id.
CREATE OR REPLACE FUNCTION public.service_membership_export(p_after uuid DEFAULT NULL, p_limit integer DEFAULT 1000)
RETURNS TABLE(account_id uuid, email text, tier text, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH qualifying AS (
    SELECT e.account_id, e.tier, e.expires_at
    FROM public.entitlements e
    WHERE e.tier IN ('essential', 'premium', 'org')
      AND e.source <> 'web'
      AND coalesce(e.raw->>'granted_by', '') <> 'soberhelpline_website_membership'
      AND (e.expires_at IS NULL OR e.expires_at > now())
      AND (p_after IS NULL OR e.account_id > p_after)
  ),
  per_account AS (
    SELECT q.account_id,
           max(CASE q.tier WHEN 'premium' THEN 3 WHEN 'org' THEN 2 ELSE 1 END) AS rank,
           CASE WHEN bool_or(q.expires_at IS NULL) THEN NULL ELSE max(q.expires_at) END AS expires_at
    FROM qualifying q
    GROUP BY q.account_id
  )
  SELECT p.account_id,
         lower(btrim(u.email::text)),
         CASE p.rank WHEN 3 THEN 'premier' WHEN 2 THEN 'org' ELSE 'essential' END,
         p.expires_at
  FROM per_account p
  JOIN public.accounts a ON a.id = p.account_id
  JOIN auth.users u ON u.id = a.user_id
  WHERE u.email_confirmed_at IS NOT NULL
    AND u.deleted_at IS NULL
    AND nullif(btrim(u.email::text), '') IS NOT NULL
  ORDER BY p.account_id
  LIMIT least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;

REVOKE ALL ON FUNCTION public.service_membership_export(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_membership_export(uuid, integer) TO service_role;

-- ── E2. Website memberships into the app ─────────────────────────────────────
-- p_members is the COMPLETE list of current website members:
-- [{ "email": text, "expires_at": timestamptz text | null }].
-- Each matched verified account keeps exactly one website-granted Essential
-- entitlement (source 'scholarship', raw.granted_by = the website marker — the
-- shape the website has always written, so its existing rows are reused).
-- Website-granted rows for accounts no longer in the list are expired now,
-- unless that would revoke more than 25% (and more than 10) of the current
-- website grants: then nothing is revoked and revocation_blocked is reported,
-- until a run with p_allow_mass_revoke. p_dry_run reports without writing.
CREATE OR REPLACE FUNCTION public.service_membership_import(
  p_members jsonb,
  p_dry_run boolean DEFAULT false,
  p_allow_mass_revoke boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET client_min_messages = warning
AS $$
DECLARE
  c_marker constant text := 'soberhelpline_website_membership';
  v_now timestamptz := now();
  v_wanted integer;
  v_matched integer;
  v_matched_emails integer;
  v_granted integer;
  v_updated integer;
  v_current integer;
  v_candidates integer;
  v_blocked boolean;
BEGIN
  IF jsonb_typeof(p_members) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid_members' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_members) > 5000 THEN
    RAISE EXCEPTION 'too_many_members' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_members) m
    WHERE jsonb_typeof(m) IS DISTINCT FROM 'object'
       OR jsonb_typeof(m->'email') IS DISTINCT FROM 'string'
       OR coalesce(jsonb_typeof(m->'expires_at'), 'missing') NOT IN ('string', 'null')
  ) THEN
    RAISE EXCEPTION 'invalid_member' USING ERRCODE = '22023';
  END IF;

  -- One import at a time.
  PERFORM pg_advisory_xact_lock(hashtextextended('service_membership_import', 0));

  DROP TABLE IF EXISTS pg_temp.membership_import_wanted;
  DROP TABLE IF EXISTS pg_temp.membership_import_matched;
  DROP TABLE IF EXISTS pg_temp.membership_import_existing;

  BEGIN
    CREATE TEMP TABLE membership_import_wanted ON COMMIT DROP AS
    SELECT i.email,
           CASE WHEN bool_or(i.open_ended) THEN NULL ELSE max(i.expires_at) END AS expires_at
    FROM (
      SELECT lower(btrim(m->>'email')) AS email,
             jsonb_typeof(m->'expires_at') = 'null' AS open_ended,
             CASE WHEN jsonb_typeof(m->'expires_at') = 'string' THEN (m->>'expires_at')::timestamptz END AS expires_at
      FROM jsonb_array_elements(p_members) m
    ) i
    GROUP BY i.email;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'invalid_member_expiry' USING ERRCODE = '22023';
  END;
  IF EXISTS (SELECT 1 FROM pg_temp.membership_import_wanted w
             WHERE w.expires_at IS NOT NULL AND NOT isfinite(w.expires_at)) THEN
    RAISE EXCEPTION 'invalid_member_expiry' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE membership_import_matched ON COMMIT DROP AS
  SELECT DISTINCT ON (a.id) a.id AS account_id, w.email, w.expires_at
  FROM pg_temp.membership_import_wanted w
  JOIN auth.users u ON lower(btrim(u.email::text)) = w.email
  JOIN public.accounts a ON a.user_id = u.id
  WHERE w.email <> ''
    AND u.email_confirmed_at IS NOT NULL
    AND u.deleted_at IS NULL
  ORDER BY a.id, w.email;

  -- Website-granted rows; rn = 1 is the one an account keeps (active first,
  -- then the latest expiry, NULL = open-ended first, then the newest).
  CREATE TEMP TABLE membership_import_existing ON COMMIT DROP AS
  SELECT e.id, e.account_id, e.tier, e.expires_at,
         (e.expires_at IS NULL OR e.expires_at > v_now) AS active,
         row_number() OVER (
           PARTITION BY e.account_id
           ORDER BY (e.expires_at IS NULL OR e.expires_at > v_now) DESC,
                    e.expires_at DESC NULLS FIRST, e.created_at DESC, e.id
         ) AS rn
  FROM public.entitlements e
  WHERE e.source = 'scholarship'
    AND e.raw->>'granted_by' = c_marker;

  SELECT count(*) INTO v_wanted FROM pg_temp.membership_import_wanted;
  SELECT count(*), count(DISTINCT m.email) INTO v_matched, v_matched_emails FROM pg_temp.membership_import_matched m;

  -- New grants (a membership that has already ended creates nothing).
  SELECT count(*) INTO v_granted
  FROM pg_temp.membership_import_matched m
  WHERE NOT EXISTS (SELECT 1 FROM pg_temp.membership_import_existing x WHERE x.account_id = m.account_id)
    AND (m.expires_at IS NULL OR m.expires_at > v_now);

  -- Kept rows whose tier or expiry changes, plus extra active duplicates.
  SELECT
    (SELECT count(*) FROM pg_temp.membership_import_matched m
       JOIN pg_temp.membership_import_existing x ON x.account_id = m.account_id AND x.rn = 1
      WHERE x.tier <> 'essential' OR x.expires_at IS DISTINCT FROM m.expires_at)
  + (SELECT count(*) FROM pg_temp.membership_import_matched m
       JOIN pg_temp.membership_import_existing x ON x.account_id = m.account_id AND x.rn > 1
      WHERE x.active)
  INTO v_updated;

  SELECT count(*) INTO v_current FROM pg_temp.membership_import_existing x WHERE x.active;
  SELECT count(*) INTO v_candidates
  FROM pg_temp.membership_import_existing x
  WHERE x.active
    AND NOT EXISTS (SELECT 1 FROM pg_temp.membership_import_matched m WHERE m.account_id = x.account_id);

  v_blocked := NOT coalesce(p_allow_mass_revoke, false)
    AND v_candidates > greatest(10, ceil(v_current * 0.25)::integer);

  IF NOT coalesce(p_dry_run, false) THEN
    INSERT INTO public.entitlements(account_id, source, tier, expires_at, raw)
    SELECT m.account_id, 'scholarship', 'essential', m.expires_at, jsonb_build_object('granted_by', c_marker)
    FROM pg_temp.membership_import_matched m
    WHERE NOT EXISTS (SELECT 1 FROM pg_temp.membership_import_existing x WHERE x.account_id = m.account_id)
      AND (m.expires_at IS NULL OR m.expires_at > v_now);

    UPDATE public.entitlements e
    SET tier = 'essential', expires_at = m.expires_at
    FROM pg_temp.membership_import_matched m
    JOIN pg_temp.membership_import_existing x ON x.account_id = m.account_id AND x.rn = 1
    WHERE e.id = x.id
      AND (x.tier <> 'essential' OR x.expires_at IS DISTINCT FROM m.expires_at);

    UPDATE public.entitlements e
    SET expires_at = v_now
    FROM pg_temp.membership_import_existing x
    JOIN pg_temp.membership_import_matched m ON m.account_id = x.account_id
    WHERE e.id = x.id AND x.rn > 1 AND x.active;

    IF NOT v_blocked THEN
      UPDATE public.entitlements e
      SET expires_at = v_now
      FROM pg_temp.membership_import_existing x
      WHERE e.id = x.id
        AND x.active
        AND NOT EXISTS (SELECT 1 FROM pg_temp.membership_import_matched m WHERE m.account_id = x.account_id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'dry_run', coalesce(p_dry_run, false),
    'matched', v_matched,
    'granted', v_granted,
    'updated', v_updated,
    'revoked', CASE WHEN v_blocked THEN 0 ELSE v_candidates END,
    'unmatched', v_wanted - v_matched_emails,
    'revocation_blocked', v_blocked,
    'revoke_candidates', v_candidates,
    'current_grants', v_current
  );
END;
$$;

REVOKE ALL ON FUNCTION public.service_membership_import(jsonb, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_membership_import(jsonb, boolean, boolean) TO service_role;

-- ── C. Schedule the RSVP/question sync every 15 minutes ──────────────────────
DO $$
DECLARE
  v_job bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;
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
      body    := '{}'::jsonb
    );
    $cron$
  );
END $$;
