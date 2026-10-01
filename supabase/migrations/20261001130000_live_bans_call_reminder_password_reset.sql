-- =============================================================================
-- 1. Removing someone from a live group is a ban: they cannot rejoin any live
--    group until an admin lets them back.
-- 2. Monday Family Squares: a push 30 minutes before the Zoom call to every
--    member with notifications on, unless they turn it off in Settings.
-- 3. Password reset requests (sent by the request-password-reset function via
--    Resend) are rate limited per email and per IP.
-- =============================================================================

-- ── 1. Live group bans ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.live_group_bans (
  account_id  uuid        PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  room_name   text        NOT NULL,
  banned_by   uuid        REFERENCES public.accounts(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.live_group_bans ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.live_group_bans FROM anon, authenticated;

-- Admin host removes a participant (identity = their account id).
CREATE OR REPLACE FUNCTION public.admin_ban_from_live_groups(p_account_id uuid, p_room_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  IF p_account_id IS NULL OR p_account_id = public.my_account_id() THEN
    RAISE EXCEPTION 'invalid_ban_target' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = p_account_id) THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.live_group_bans (account_id, room_name, banned_by)
  VALUES (p_account_id, coalesce(nullif(btrim(p_room_name), ''), 'unknown'), public.my_account_id())
  ON CONFLICT (account_id) DO UPDATE
    SET room_name = EXCLUDED.room_name, banned_by = EXCLUDED.banned_by, created_at = now();

  -- A removed member stops getting "we're live" invitations too.
  DELETE FROM public.group_rsvps WHERE account_id = p_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_lift_live_group_ban(p_account_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.live_group_bans WHERE account_id = p_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_live_group_bans()
RETURNS TABLE (account_id uuid, first_name text, last_name text, room_name text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT b.account_id, a.first_name, a.last_name, b.room_name, b.created_at
  FROM public.live_group_bans b
  JOIN public.accounts a ON a.id = b.account_id
  ORDER BY b.created_at DESC;
END;
$$;

-- The caller's own status, used by livekit-token and the RSVP path.
CREATE OR REPLACE FUNCTION public.am_banned_from_live_groups()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.live_group_bans WHERE account_id = public.my_account_id());
$$;

REVOKE EXECUTE ON FUNCTION public.admin_ban_from_live_groups(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_lift_live_group_ban(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_live_group_bans() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.am_banned_from_live_groups() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ban_from_live_groups(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_lift_live_group_ban(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_live_group_bans() TO authenticated;
GRANT EXECUTE ON FUNCTION public.am_banned_from_live_groups() TO authenticated, service_role;

-- ── 2. 30-minute Family Squares reminder ─────────────────────────────────────
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS family_call_reminders boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.set_family_call_reminders(p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'invalid_preference' USING ERRCODE = '22023';
  END IF;
  UPDATE public.accounts SET family_call_reminders = p_enabled WHERE id = public.my_account_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_account' USING ERRCODE = '28000';
  END IF;
END;
$$;

-- Everyone with a device who hasn't opted out. Members who RSVP'd going already
-- get the 1-hour and 15-minute reminders, so they are not pinged a third time;
-- members who declined this week's call (RSVPs reset every Tuesday) said they
-- can't make it, so they aren't told to tap to join.
CREATE OR REPLACE FUNCTION public.get_family_call_30min_targets()
RETURNS TABLE (push_token text, locale text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (a.push_token) a.push_token, a.locale
  FROM public.accounts a
  WHERE a.push_token IS NOT NULL
    AND a.family_call_reminders
    AND NOT EXISTS (
      SELECT 1 FROM public.session_rsvps sr
      WHERE sr.account_id = a.id
        AND sr.session_id = public.family_squares_session_id()
        AND sr.status IN ('going', 'declined')
    );
$$;

REVOKE EXECUTE ON FUNCTION public.set_family_call_reminders(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_family_call_reminders(boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_family_call_30min_targets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_family_call_30min_targets() TO service_role;

-- Monday 6:30 PM Pacific falls at 01:30 UTC (PDT) or 02:30 UTC (PST); the
-- function sends only during the Pacific 6 PM hour.
DO $$
DECLARE
  v_job bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'shl-family-call-30min';
  IF v_job IS NOT NULL THEN
    PERFORM cron.unschedule(v_job);
  END IF;
  PERFORM cron.schedule(
    'shl-family-call-30min',
    '30 1,2 * * 2',
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
      body    := '{"job":"family_call_30min"}'::jsonb
    );
    $cron$
  );
END $$;

-- ── 3. Password reset rate limits ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.password_reset_requests (
  id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email_hash  text        NOT NULL,
  ip_hash     text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS password_reset_requests_email_idx ON public.password_reset_requests (email_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS password_reset_requests_ip_idx ON public.password_reset_requests (ip_hash, created_at DESC);
ALTER TABLE public.password_reset_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_reset_requests FROM anon, authenticated;

-- Records the request and says whether it may proceed: 3 per email and 10 per
-- IP per hour, plus a high overall circuit breaker. Codes are only ever emailed
-- to existing accounts, so the overall cap guards the endpoint, not inboxes; it
-- is set far above real use so made-up addresses can't block everyone's reset.
-- Hashes only; no addresses are stored.
CREATE OR REPLACE FUNCTION public.register_password_reset_request(p_email_hash text, p_ip_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email_count integer;
  v_ip_count integer;
BEGIN
  IF coalesce(length(p_email_hash), 0) <> 64 OR coalesce(length(p_ip_hash), 0) <> 64 THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.password_reset_requests WHERE created_at < now() - interval '1 day';

  SELECT count(*) INTO v_email_count FROM public.password_reset_requests
  WHERE email_hash = p_email_hash AND created_at > now() - interval '1 hour';
  SELECT count(*) INTO v_ip_count FROM public.password_reset_requests
  WHERE ip_hash = p_ip_hash AND created_at > now() - interval '1 hour';

  -- Global circuit breaker in case the client IP can't be trusted.
  IF v_email_count >= 3 OR v_ip_count >= 10
     OR (SELECT count(*) FROM public.password_reset_requests WHERE created_at > now() - interval '1 hour') >= 5000 THEN
    RETURN false;
  END IF;

  INSERT INTO public.password_reset_requests (email_hash, ip_hash) VALUES (p_email_hash, p_ip_hash);
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_password_reset_request(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_password_reset_request(text, text) TO service_role;

-- A banned member cannot RSVP (and so is never invited by a go-live push),
-- through the RPC or the direct insert older app versions still use.
CREATE OR REPLACE FUNCTION public.set_group_rsvp(p_room_name text, p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid := public.my_account_id();
BEGIN
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_room_name IS NULL OR p_room_name NOT IN (
    'shp-parents', 'shp-spouses', 'shp-boundaries', 'shp-treatment'
  ) THEN
    RAISE EXCEPTION 'invalid_group_room' USING ERRCODE = '22023';
  END IF;

  IF p_enabled THEN
    IF EXISTS (SELECT 1 FROM public.live_group_bans WHERE account_id = v_account_id) THEN
      RAISE EXCEPTION 'removed_from_live_groups' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.group_rsvps(account_id, room_name)
    VALUES (v_account_id, p_room_name)
    ON CONFLICT (account_id, room_name) DO NOTHING;
  ELSE
    DELETE FROM public.group_rsvps
    WHERE account_id = v_account_id AND room_name = p_room_name;
  END IF;

  RETURN p_enabled;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_group_rsvp(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_group_rsvp(text, boolean) TO authenticated;

DROP POLICY IF EXISTS "group_rsvps: compatible insert" ON public.group_rsvps;
CREATE POLICY "group_rsvps: compatible insert" ON public.group_rsvps
  FOR INSERT TO authenticated
  WITH CHECK (
    account_id = public.my_account_id()
    AND room_name = ANY (ARRAY['shp-parents', 'shp-spouses', 'shp-boundaries', 'shp-treatment'])
    AND NOT public.am_banned_from_live_groups()
  );

-- ── Provider access as the app should display it ─────────────────────────────
-- Members cannot read orgs; the app asks whether its attached access is live so
-- a suspended provider's members see the same tier the server enforces.
CREATE OR REPLACE FUNCTION public.my_provider_access_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.accounts a
    JOIN public.orgs o ON o.id = a.org_id
    WHERE a.id = public.my_account_id()
      AND a.type = 'attached'
      AND o.status = 'active'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.my_provider_access_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_provider_access_active() TO authenticated;
