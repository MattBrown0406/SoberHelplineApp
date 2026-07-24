-- =============================================================================
-- Multi-admin support + SSO replay hardening
--
-- 1. Centralizes the admin identity behind public.admin_email_list() /
--    public.is_admin_jwt() and admits matt@freedominterventions.com as a second
--    admin alongside matt@soberhelpline.com.
-- 2. Recreates every function and RLS policy that gated on the hardcoded
--    'matt@soberhelpline.com' literal, using each object's LATEST definition
--    (superseded definitions are not re-asserted):
--      set_host_live                     -> 20260713020000 (newest)
--      video sessions owner/admin policies -> 20260708120000 (dropped by
--                                           20260712120000; recreated here so the
--                                           admin email is centralized in all states)
--      admin_account_id + triggers       -> 20260709150000
--      has_active_private_video_access   -> 20260708120000 (latest)
--      has_active_textline_access + textline policies/functions
--                                        -> 20260707100000 (latest)
--      family squares admin RPCs         -> 20260703100000 (latest)
--      funnel policy + admin_funnel_stats-> 20260621110000 (latest)
--      community policies                -> 20260621000000 (latest)
--      read_thread_reactions             -> 20260619000003 (latest)
--      archive_thread                    -> 20260619000000 (latest)
--      admin_get_active_threads          -> 20260714010339 (hardened version,
--                                           Task 3: guarantee the fix is deployed)
--    Legacy single-admin rows are preserved; the freedominterventions account is
--    seeded idempotently into group_hosts and video_staff_roles, guarded on the
--    auth.users row existing.
-- 3. Defense-in-depth for web_sso_tokens (see validate-sso-token Edge Function,
--    which now redeems with one atomic conditional UPDATE).
-- =============================================================================

-- ─── Central admin identity ──────────────────────────────────────────────────
-- Single source of truth for who is an admin. Edge Functions mirror this list
-- in supabase/functions/_shared/admin.ts; the app mirrors it in src/lib/admin.ts.
CREATE OR REPLACE FUNCTION public.admin_email_list()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY['matt@soberhelpline.com','matt@freedominterventions.com']
$$;

CREATE OR REPLACE FUNCTION public.is_admin_jwt()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT lower(coalesce(auth.jwt() ->> 'email','')) = ANY (public.admin_email_list())
$$;

-- Both helpers are SECURITY INVOKER: safe for any signed-in caller to evaluate
-- (they return no data beyond a boolean/array the caller could derive from
-- their own JWT), and RLS policies need EXECUTE for policy evaluation.
REVOKE EXECUTE ON FUNCTION public.admin_email_list() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin_jwt() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_email_list() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin_jwt() TO authenticated, service_role;

-- ─── group_hosts: seed the second admin as host of every moderated room ──────
-- Idempotent; no-op until the freedominterventions auth user + account exist.
-- Guarded on the auth.users row existing so the seed is a no-op until the
-- freedominterventions user signs up (the account is provisioned on sign-in).
INSERT INTO public.group_hosts (room_name, account_id)
SELECT r.room_name, a.id
FROM (VALUES ('shp-parents'), ('shp-spouses'), ('shp-boundaries'), ('shp-treatment')) AS r(room_name)
CROSS JOIN public.accounts a
JOIN auth.users u ON u.id = a.user_id
WHERE lower(u.email) = 'matt@freedominterventions.com'
  AND EXISTS (SELECT 1 FROM auth.users au WHERE lower(au.email) = 'matt@freedominterventions.com')
ON CONFLICT DO NOTHING;

-- ─── video_staff_roles: seed the second admin as owner ───────────────────────
-- Mirrors the bootstrap seed for matt@soberhelpline.com in
-- 20260712120000_premier_video_scheduling.sql. Idempotent and guarded on the
-- auth.users row existing.
INSERT INTO public.video_staff_roles (account_id, role)
SELECT a.id, 'owner'
FROM public.accounts a
JOIN auth.users u ON u.id = a.user_id
WHERE lower(u.email) = 'matt@freedominterventions.com'
  AND EXISTS (SELECT 1 FROM auth.users au WHERE lower(au.email) = 'matt@freedominterventions.com')
ON CONFLICT (account_id) DO UPDATE SET role = 'owner', active = true, updated_at = now();

-- ─── set_host_live: latest definition (20260713020000) with multi-admin gate ─
CREATE OR REPLACE FUNCTION public.set_host_live(
  p_room_name text,
  p_is_live boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid := public.my_account_id();
  v_current_live boolean;
  v_event_id uuid;
  v_service_key text;
BEGIN
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_room_name IS NULL OR p_room_name NOT IN (
    'shp-parents', 'shp-spouses', 'shp-boundaries', 'shp-treatment'
  ) THEN
    RAISE EXCEPTION 'invalid_group_room' USING ERRCODE = '22023';
  END IF;

  SELECT gh.is_live
  INTO v_current_live
  FROM public.group_hosts gh
  JOIN public.accounts a ON a.id = gh.account_id
  JOIN auth.users u ON u.id = a.user_id
  WHERE gh.room_name = p_room_name
    AND gh.account_id = v_account_id
    AND a.user_id = auth.uid()
    AND lower(u.email) = ANY (public.admin_email_list())
  FOR UPDATE OF gh;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_group_host' USING ERRCODE = '42501';
  END IF;

  IF p_is_live AND NOT v_current_live THEN
    -- SHARE conflicts with the ROW EXCLUSIVE lock taken by both RPC and legacy
    -- direct RSVP mutations. Requests begun before Go Live therefore commit
    -- before this transaction takes its subscriber snapshot.
    LOCK TABLE public.group_rsvps IN SHARE MODE;
    v_event_id := gen_random_uuid();

    UPDATE public.group_hosts
    SET is_live = true,
        live_event_id = v_event_id,
        live_started_at = now()
    WHERE room_name = p_room_name AND account_id = v_account_id;

    INSERT INTO public.push_outbox(
      account_id, kind, title, body, metadata, idempotency_key, scheduled_for
    )
    SELECT
      gr.account_id,
      'group_live',
      CASE WHEN coalesce(a.locale, 'en') LIKE 'es%'
        THEN 'La sesión en vivo comienza ahora'
        ELSE 'Live session starting now'
      END,
      CASE WHEN coalesce(a.locale, 'en') LIKE 'es%'
        THEN (CASE p_room_name
          WHEN 'shp-parents' THEN 'Padres de jóvenes adultos con adicción'
          WHEN 'shp-spouses' THEN 'Cónyuges y parejas'
          WHEN 'shp-boundaries' THEN 'Establecer y mantener límites'
          WHEN 'shp-treatment' THEN 'Encontrar el programa de tratamiento adecuado'
        END) || ' está en vivo — toca para unirte'
        ELSE (CASE p_room_name
          WHEN 'shp-parents' THEN 'Parents of Addicted Young Adults'
          WHEN 'shp-spouses' THEN 'Spouses & Partners'
          WHEN 'shp-boundaries' THEN 'Setting & Holding Boundaries'
          WHEN 'shp-treatment' THEN 'Finding the Right Treatment Program'
        END) || ' just went live — tap to join'
      END,
      jsonb_build_object(
        'kind', 'group_live',
        'screen', 'live-room',
        'room_name', p_room_name,
        'event_id', v_event_id,
        'deep_link', 'sober-helpline://live-room?room=' || p_room_name
      ),
      'group-live:' || p_room_name || ':' || v_event_id::text || ':' || gr.account_id::text,
      now()
    FROM public.group_rsvps gr
    JOIN public.accounts a ON a.id = gr.account_id
    WHERE gr.room_name = p_room_name
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'
    LIMIT 1;

    IF v_service_key IS NOT NULL THEN
      PERFORM net.http_post(
        url := 'https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/send-engagement-push',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_service_key
        ),
        body := jsonb_build_object('job', 'drain')
      );
    END IF;
  ELSIF NOT p_is_live AND v_current_live THEN
    UPDATE public.group_hosts
    SET is_live = false
    WHERE room_name = p_room_name AND account_id = v_account_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_host_live(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_host_live(text, boolean) TO authenticated;

-- ─── admin_account_id: single-row push target ────────────────────────────────
-- This helper returns ONE admin account id because its callers
-- (_notify_admin_video_request, _notify_admin_textline_message, and
-- 20260709170000_video_schedule_member_push) enqueue a single push_outbox row
-- per event. With two admins it deterministically returns the
-- matt@soberhelpline.com account as the primary push target; the
-- freedominterventions admin is reached through video_staff_roles-based
-- fan-out (all active staff are pushed on scheduling events) and shares every
-- admin capability via is_admin_jwt(). Cardinality is unchanged.
CREATE OR REPLACE FUNCTION public.admin_account_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id
  FROM public.accounts a
  JOIN auth.users u ON u.id = a.user_id
  WHERE lower(u.email) = ANY (public.admin_email_list())
  ORDER BY lower(u.email) = 'matt@soberhelpline.com' DESC, a.created_at ASC
  LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION public.admin_account_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_account_id() TO service_role;

-- Trigger bodies reference admin_account_id() only; recreate them so the
-- definer/grant posture is explicit alongside the new helper.
CREATE OR REPLACE FUNCTION public._notify_admin_video_request()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin uuid := public.admin_account_id();
BEGIN
  -- Skip self-requests (admin testing) and missing admin account.
  IF v_admin IS NOT NULL AND NEW.account_id IS DISTINCT FROM v_admin
     AND NEW.status = 'requested' THEN
    INSERT INTO public.push_outbox (account_id, kind, title, body)
    VALUES (
      v_admin,
      'admin_video_request',
      '🎥 New private video request',
      'A member requested a private video session. Open Admin to schedule or start it.'
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._notify_admin_textline_message()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin uuid := public.admin_account_id();
  v_thread public.threads%ROWTYPE;
BEGIN
  IF NEW.sender_role = 'member' AND v_admin IS NOT NULL THEN
    SELECT * INTO v_thread FROM public.threads WHERE id = NEW.thread_id;
    IF v_thread.kind = 'oncall' AND v_thread.account_id IS DISTINCT FROM v_admin THEN
      INSERT INTO public.push_outbox (account_id, kind, title, body)
      VALUES (
        v_admin,
        'admin_textline_message',
        '💬 New Urgent Text Line message',
        'A member sent a new message. Open Admin to read and reply.'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ─── has_active_private_video_access (latest: 20260708120000) ────────────────
CREATE OR REPLACE FUNCTION public.has_active_private_video_access(p_account_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.accounts a
    WHERE a.id = p_account_id
      AND (
        a.type = 'attached'
        OR EXISTS (
          SELECT 1
          FROM public.entitlements e
          WHERE e.account_id = p_account_id
            AND e.tier IN ('premium', 'org')
            AND (e.expires_at IS NULL OR e.expires_at > now())
        )
        OR public.is_admin_jwt()
      )
  );
$$;

-- ─── video_sessions legacy owner/admin policies (latest: 20260708120000) ─────
-- 20260712120000 dropped these when it introduced the staff-role model; the
-- DROP IF EXISTS below keeps that newer state intact while making any
-- database that still has the legacy policies admin-centralized.
DROP POLICY IF EXISTS "video sessions: owner/admin select" ON public.video_sessions;
CREATE POLICY "video sessions: owner/admin select" ON public.video_sessions FOR SELECT
  USING (
    account_id = public.my_account_id()
    OR public.is_admin_jwt()
  );

DROP POLICY IF EXISTS "video sessions: owner request" ON public.video_sessions;
CREATE POLICY "video sessions: owner request" ON public.video_sessions FOR INSERT
  WITH CHECK (
    account_id = public.my_account_id()
    AND public.has_active_private_video_access(account_id)
  );

DROP POLICY IF EXISTS "video sessions: admin update" ON public.video_sessions;
CREATE POLICY "video sessions: admin update" ON public.video_sessions FOR UPDATE
  USING (public.is_admin_jwt())
  WITH CHECK (public.is_admin_jwt());

-- ─── has_active_textline_access (latest: 20260707100000) ─────────────────────
CREATE OR REPLACE FUNCTION public.has_active_textline_access(p_account_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.accounts a
    WHERE a.id = p_account_id
      AND (
        a.type = 'attached'
        OR EXISTS (
          SELECT 1
          FROM public.entitlements e
          WHERE e.account_id = p_account_id
            AND e.tier IN ('essential', 'premium', 'org')
            AND (e.expires_at IS NULL OR e.expires_at > now())
        )
        OR public.is_admin_jwt()
      )
  );
$$;

-- ─── Emergency Text Line RLS policies (latest: 20260707100000) ───────────────
DROP POLICY IF EXISTS "threads: admin select" ON public.threads;
CREATE POLICY "threads: admin select" ON public.threads FOR SELECT
  USING (public.is_admin_jwt());

DROP POLICY IF EXISTS "threads: admin update" ON public.threads;
CREATE POLICY "threads: admin update" ON public.threads FOR UPDATE
  USING (public.is_admin_jwt())
  WITH CHECK (public.is_admin_jwt());

DROP POLICY IF EXISTS "messages: admin select" ON public.messages;
CREATE POLICY "messages: admin select" ON public.messages FOR SELECT
  USING (public.is_admin_jwt());

DROP POLICY IF EXISTS "messages: admin insert as coach" ON public.messages;
CREATE POLICY "messages: admin insert as coach" ON public.messages FOR INSERT
  WITH CHECK (
    public.is_admin_jwt()
    AND sender_role = 'coach'
  );

DROP POLICY IF EXISTS "attachments: admin select" ON public.message_attachments;
CREATE POLICY "attachments: admin select" ON public.message_attachments FOR SELECT
  USING (public.is_admin_jwt());

DROP POLICY IF EXISTS "ai drafts: admin select" ON public.ai_response_drafts;
CREATE POLICY "ai drafts: admin select" ON public.ai_response_drafts FOR SELECT
  USING (public.is_admin_jwt());

DROP POLICY IF EXISTS "chat attachments owner read" ON storage.objects;
CREATE POLICY "chat attachments owner read" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'chat-attachments'
    AND (
      (storage.foldername(name))[1] = public.my_account_id()::text
      OR public.is_admin_jwt()
    )
  );

-- ─── Textline admin helper RPCs (latest: 20260707100000) ─────────────────────
CREATE OR REPLACE FUNCTION public.admin_mark_thread_read(p_thread_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.threads SET last_admin_read_at = now() WHERE id = p_thread_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_send_thread_message(p_thread_id uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message_id uuid;
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  INSERT INTO public.messages (thread_id, sender_role, body)
  VALUES (p_thread_id, 'coach', trim(p_body))
  RETURNING id INTO v_message_id;

  UPDATE public.threads SET last_admin_read_at = now() WHERE id = p_thread_id;
  RETURN v_message_id;
END;
$$;

-- Explicit ACL posture for the admin-only RPCs recreated above (their original
-- migrations left PostgreSQL's default PUBLIC execute grant in place; the
-- in-body is_admin_jwt() gate was the only check — keep the gate AND lock the
-- grant down like the rest of the hardened surface).
REVOKE EXECUTE ON FUNCTION public.admin_mark_thread_read(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_send_thread_message(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_thread_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_send_thread_message(uuid, text) TO authenticated;

-- ─── admin_get_active_threads (Task 3: guarantee the 20260714010339 fix) ─────
-- Recreated verbatim from 20260714010339_close_critical_rpc_and_table_grant_gaps.sql
-- (is_video_staff() gate — both admins are seeded into video_staff_roles as
-- owners above, so the staff gate already covers the new admin) with the
-- revoke/grant hardening re-applied explicitly. Idempotent: safe no matter
-- which definition production currently has.
CREATE OR REPLACE FUNCTION public.admin_get_active_threads()
RETURNS TABLE(
  thread_id uuid,
  first_name text,
  last_name text,
  last_message text,
  last_message_at timestamptz,
  message_count bigint,
  unread_count bigint,
  risk_level text,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_video_staff() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    a.first_name,
    a.last_name,
    (SELECT m.body FROM public.messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1),
    COALESCE(t.last_message_at, (SELECT m.created_at FROM public.messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1)),
    (SELECT count(*) FROM public.messages m WHERE m.thread_id = t.id),
    (SELECT count(*) FROM public.messages m
      WHERE m.thread_id = t.id
        AND m.sender_role = 'member'
        AND (t.last_admin_read_at IS NULL OR m.created_at > t.last_admin_read_at)),
    t.risk_level,
    t.status
  FROM public.threads t
  JOIN public.accounts a ON a.id = t.account_id
  WHERE t.archived_at IS NULL
    AND t.kind = 'oncall'
  ORDER BY COALESCE(t.last_message_at, (SELECT m.created_at FROM public.messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1)) DESC NULLS LAST
  LIMIT 100;
END
$$;

-- Matches 20260714010339 exactly (plus an explicit PUBLIC revoke for clarity;
-- CREATE OR REPLACE preserves ACLs, so be explicit about the final posture).
REVOKE ALL ON FUNCTION public.admin_get_active_threads() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_active_threads() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_active_threads() TO authenticated;

-- ─── Family Squares admin RPCs (latest: 20260703100000) ──────────────────────
CREATE OR REPLACE FUNCTION public.admin_update_family_squares_zoom_url(p_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.sessions SET zoom_url = p_url WHERE id = public.family_squares_session_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Family Squares session row not found — zoom link NOT saved';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_family_squares_rsvps()
RETURNS TABLE(first_name text, last_name text, email text, rsvped_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  SELECT a.first_name, a.last_name, u.email::text, sr.created_at
  FROM public.session_rsvps sr
  JOIN public.accounts a ON a.id  = sr.account_id
  JOIN auth.users u ON u.id = a.user_id
  WHERE sr.session_id = public.family_squares_session_id()
    AND sr.status = 'going'
  ORDER BY sr.created_at DESC;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_get_session_questions(text);
CREATE FUNCTION public.admin_get_session_questions(p_session_title text DEFAULT NULL)
RETURNS TABLE(id uuid, first_name text, last_name text, question text, submitted_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  SELECT sq.id, a.first_name, a.last_name, sq.question, sq.created_at
  FROM public.session_questions sq
  JOIN public.accounts a ON a.id = sq.account_id
  WHERE sq.session_id = CASE
    WHEN p_session_title IS NULL THEN public.family_squares_session_id()
    ELSE (SELECT s.id FROM public.sessions s WHERE s.title = p_session_title LIMIT 1)
  END
  ORDER BY sq.created_at DESC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_update_family_squares_zoom_url(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_family_squares_rsvps() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_get_session_questions(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_family_squares_zoom_url(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_family_squares_rsvps() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_session_questions(text) TO authenticated;

-- ─── Funnel analytics (latest: 20260621110000) ───────────────────────────────
DROP POLICY IF EXISTS "funnel_events: read own or admin" ON public.funnel_events;
CREATE POLICY "funnel_events: read own or admin" ON public.funnel_events FOR SELECT
  USING (
    account_id = public.my_account_id()
    OR public.is_admin_jwt()
  );

CREATE OR REPLACE FUNCTION public.admin_funnel_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  WITH mood AS (
    SELECT account_id, count(*) FILTER (WHERE mood <= 2) AS low_days
    FROM public.checkins
    WHERE created_at >= now() - interval '7 days'
    GROUP BY account_id
  ),
  trk AS (
    SELECT account_id,
      count(*) FILTER (WHERE kind = 'warning')  AS warn,
      count(*) FILTER (WHERE kind = 'recovery') AS recov
    FROM public.tracker_logs
    WHERE week >= current_date - 14
    GROUP BY account_id
  ),
  scored AS (
    SELECT a.id,
      (coalesce(m.low_days, 0) * 10)
      + (greatest(coalesce(t.warn, 0) - coalesce(t.recov, 0), 0) * 10)
      + CASE coalesce(lo.status, 'unknown')
          WHEN 'stable' THEN 0
          WHEN 'in_treatment' THEN 0
          WHEN 'unknown' THEN 5
          WHEN 'using' THEN 15
          WHEN 'escalating' THEN 25
          WHEN 'crisis' THEN 35
          ELSE 5
        END AS score
    FROM public.accounts a
    LEFT JOIN mood m       ON m.account_id  = a.id
    LEFT JOIN trk  t       ON t.account_id  = a.id
    LEFT JOIN public.loved_ones lo ON lo.account_id = a.id
  )
  SELECT jsonb_build_object(
    'members',             (SELECT count(*) FROM public.accounts),
    'onboarded_loved_one', (SELECT count(*) FROM public.loved_ones),
    'free_rsvps',          (SELECT count(DISTINCT sr.account_id)
                              FROM public.session_rsvps sr
                              JOIN public.sessions s ON s.id = sr.session_id
                              WHERE s.kind = 'group' AND sr.status = 'going'),
    'attended',            (SELECT count(DISTINCT account_id) FROM public.funnel_events
                              WHERE stage = 'attended'),
    'coaching_requested',  (SELECT count(DISTINCT account_id) FROM public.coaching_bookings),
    'coaching_confirmed',  (SELECT count(DISTINCT account_id) FROM public.coaching_bookings
                              WHERE status IN ('confirmed', 'completed')),
    'intervention_viewed',  (SELECT count(DISTINCT account_id) FROM public.funnel_events
                              WHERE stage = 'intervention_viewed'),
    'intervention_started', (SELECT count(DISTINCT account_id) FROM public.funnel_events
                              WHERE stage = 'intervention_started'),
    'bands', jsonb_build_object(
      'calm',     (SELECT count(*) FROM scored WHERE score < 10),
      'watch',    (SELECT count(*) FROM scored WHERE score >= 10 AND score < 30),
      'elevated', (SELECT count(*) FROM scored WHERE score >= 30 AND score < 60),
      'crisis',   (SELECT count(*) FROM scored WHERE score >= 60)
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_funnel_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_funnel_stats() TO authenticated;

-- ─── Community moderation policies (latest: 20260621000000) ──────────────────
DROP POLICY IF EXISTS "community_posts: read" ON public.community_posts;
CREATE POLICY "community_posts: read" ON public.community_posts FOR SELECT
  USING (
    status = 'visible'
    OR account_id = public.my_account_id()
    OR public.is_admin_jwt()
  );

DROP POLICY IF EXISTS "community_posts: delete" ON public.community_posts;
CREATE POLICY "community_posts: delete" ON public.community_posts FOR DELETE
  USING (
    account_id = public.my_account_id()
    OR public.is_admin_jwt()
  );

DROP POLICY IF EXISTS "community_reports: admin read" ON public.community_reports;
CREATE POLICY "community_reports: admin read" ON public.community_reports FOR SELECT
  USING (public.is_admin_jwt());

-- ─── Message reactions policy (latest: 20260619000003) ───────────────────────
DROP POLICY IF EXISTS "read_thread_reactions" ON public.message_reactions;
CREATE POLICY "read_thread_reactions" ON public.message_reactions FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.messages m
    JOIN public.threads t ON t.id = m.thread_id
    WHERE m.id = message_reactions.message_id
      AND (
        t.account_id = (SELECT id FROM public.accounts WHERE user_id = auth.uid())
        OR public.is_admin_jwt()
      )
  )
);

-- ─── archive_thread (latest: 20260619000000) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.archive_thread(p_thread_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin_jwt() THEN
    UPDATE public.threads SET archived_at = now() WHERE id = p_thread_id;
  ELSE
    UPDATE public.threads
    SET archived_at = now()
    WHERE id = p_thread_id
      AND account_id = public.my_account_id();
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.archive_thread(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_thread(uuid) TO authenticated;

-- ─── Task 2: web_sso_tokens defense-in-depth ─────────────────────────────────
-- validate-sso-token now redeems with ONE atomic conditional UPDATE, which
-- alone closes the concurrent-redemption race (id is the PRIMARY KEY, so a
-- second partial unique index on id would be redundant and is intentionally
-- skipped). This partial index keeps "one live token per account" true as
-- defense-in-depth against token spraying: at most one unused+unexpired token
-- exists per account, so a race loser cannot redeem a stale sibling token.
CREATE UNIQUE INDEX IF NOT EXISTS web_sso_tokens_one_live_per_account_idx
  ON public.web_sso_tokens (account_id)
  WHERE used_at IS NULL;
