-- =============================================================================
-- Audit round 1.
-- * The "we're live" push named the group ("Parents of Addicted Young
--   Adults", "Finding the Right Treatment Program") on the lock screen, where
--   the loved one may see it. Neutral copy now; the group is shown in the app.
-- * Community "support" pushes carried no routing data and opened Today.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_host_live(p_room_name text, p_is_live boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid := public.my_account_id();
  v_current_live boolean;
  v_started_at timestamptz;
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

  SELECT gh.is_live, gh.live_started_at
  INTO v_current_live, v_started_at
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

  -- A broadcast that ended without the host's "end" call (app killed, lost
  -- network) leaves is_live set; after 3 hours a new go-live is a new event
  -- so RSVP'd members are notified again.
  IF p_is_live AND (
    NOT v_current_live
    OR v_started_at IS NULL
    OR v_started_at < now() - interval '3 hours'
  ) THEN
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
        THEN 'Tu grupo en vivo está comenzando'
        ELSE 'Your live group is starting'
      END,
      -- The group's name reveals what it is about; keep it inside the app.
      CASE WHEN coalesce(a.locale, 'en') LIKE 'es%'
        THEN 'Toca para unirte.'
        ELSE 'Tap to join.'
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
      -- Live groups are a membership benefit: only members are invited in.
      AND (
        (a.type = 'attached'
          AND EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = a.org_id AND o.status = 'active'))
        OR EXISTS (
          SELECT 1 FROM public.entitlements e
          WHERE e.account_id = a.id
            AND e.tier IN ('essential', 'premium', 'org')
            AND (e.expires_at IS NULL OR e.expires_at > now())
        )
      )
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
$function$
;

REVOKE EXECUTE ON FUNCTION public.set_host_live(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_host_live(text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.support_community_post(p_post_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account uuid := my_account_id();
  v_author  uuid;
  v_locale  text;
  v_count   int;
  v_inserted boolean := false;
BEGIN
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT account_id INTO v_author
  FROM community_posts
  WHERE id = p_post_id AND status = 'visible';
  IF v_author IS NULL THEN
    RAISE EXCEPTION 'post_not_found';
  END IF;

  INSERT INTO community_supports (post_id, supporter_account_id)
  VALUES (p_post_id, v_account)
  ON CONFLICT DO NOTHING;
  v_inserted := FOUND;

  IF v_inserted THEN
    UPDATE community_posts
    SET support_count = support_count + 1
    WHERE id = p_post_id
    RETURNING support_count INTO v_count;

    IF v_author <> v_account THEN
      SELECT locale INTO v_locale FROM accounts WHERE id = v_author;
      IF v_locale LIKE 'es%' THEN
        INSERT INTO push_outbox (account_id, kind, title, body, metadata)
        VALUES (
          v_author,
          'community_support',
          'Alguien te envió apoyo 💙',
          'Una familia respondió a tu publicación en la comunidad. No estás sola en esto.',
          jsonb_build_object('kind', 'community_support', 'post_id', p_post_id)
        );
      ELSE
        INSERT INTO push_outbox (account_id, kind, title, body, metadata)
        VALUES (
          v_author,
          'community_support',
          'Someone sent you support 💙',
          'A family member responded to your post in the community. You are not alone in this.',
          jsonb_build_object('kind', 'community_support', 'post_id', p_post_id)
        );
      END IF;
    END IF;
  ELSE
    SELECT support_count INTO v_count FROM community_posts WHERE id = p_post_id;
  END IF;

  RETURN v_count;
END;
$function$
;

REVOKE EXECUTE ON FUNCTION public.support_community_post(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_community_post(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- Family space: private wavering recorded before the fix (20260930230000) set
-- the commitment to 'wavering' whatever it was before, so relatives still see
-- it. Without a shared wavering, restore what the family should see: the
-- wall's proposer was committed automatically; anyone else goes back to
-- "not yet" (no commitment row).
-- -----------------------------------------------------------------------------
UPDATE public.wall_commitments c
SET status = 'committed', updated_at = now()
FROM public.shared_walls sw
WHERE sw.id = c.shared_wall_id
  AND c.account_id = sw.proposed_by
  AND c.status = 'wavering'
  AND NOT EXISTS (
    SELECT 1 FROM public.wavering_events e
    WHERE e.shared_wall_id = c.shared_wall_id
      AND e.account_id = c.account_id
      AND e.shared_with_family
  );
DELETE FROM public.wall_commitments c
WHERE c.status = 'wavering'
  AND NOT EXISTS (
    SELECT 1 FROM public.wavering_events e
    WHERE e.shared_wall_id = c.shared_wall_id
      AND e.account_id = c.account_id
      AND e.shared_with_family
  );

-- A member can leave their family space (one space per member, so this is the
-- only way to join a different family). An owner hands the space to the
-- longest-standing member, as account deletion does; the last member leaving
-- removes the space. Walls they proposed stay with the family.
CREATE OR REPLACE FUNCTION public.leave_family_space()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := public.my_account_id();
  v_space uuid;
  v_successor record;
BEGIN
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT family_space_id INTO v_space FROM public.family_members WHERE account_id = v_account;
  IF v_space IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.family_spaces WHERE id = v_space AND created_by = v_account) THEN
    SELECT fm.account_id, a.first_name INTO v_successor
    FROM public.family_members fm
    JOIN public.accounts a ON a.id = fm.account_id
    WHERE fm.family_space_id = v_space AND fm.account_id <> v_account
    ORDER BY fm.joined_at ASC, fm.id ASC
    LIMIT 1;

    IF v_successor.account_id IS NULL THEN
      DELETE FROM public.family_spaces WHERE id = v_space;
      RETURN;
    END IF;

    UPDATE public.family_spaces
    SET created_by = v_successor.account_id,
        name = coalesce(nullif(btrim(v_successor.first_name), ''), name)
    WHERE id = v_space;
    UPDATE public.family_members SET role = 'owner'
    WHERE family_space_id = v_space AND account_id = v_successor.account_id;
  END IF;

  DELETE FROM public.wall_commitments wc
  USING public.shared_walls sw
  WHERE wc.shared_wall_id = sw.id AND sw.family_space_id = v_space AND wc.account_id = v_account;
  -- What they shared with this family stops being shared once they leave.
  UPDATE public.wavering_events we
  SET shared_with_family = false
  FROM public.shared_walls sw
  WHERE we.shared_wall_id = sw.id AND sw.family_space_id = v_space AND we.account_id = v_account;
  UPDATE public.wall_hold_logs
  SET shared_with_family = false, family_space_id = NULL
  WHERE account_id = v_account AND family_space_id = v_space;
  DELETE FROM public.family_members WHERE family_space_id = v_space AND account_id = v_account;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.leave_family_space() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_family_space() TO authenticated;

-- -----------------------------------------------------------------------------
-- Community moderation: report alerts go to admins, so admins can act on them.
-- Restoring a post clears its reports (otherwise the next report re-holds it).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.moderate_community_post(p_post_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_admin_jwt() OR public.is_video_owner()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF p_status NOT IN ('visible', 'held', 'removed') THEN
    RAISE EXCEPTION 'bad_status';
  END IF;
  UPDATE public.community_posts SET status = p_status WHERE id = p_post_id;
  IF p_status = 'visible' THEN
    DELETE FROM public.community_reports WHERE post_id = p_post_id;
    UPDATE public.community_posts SET report_count = 0 WHERE id = p_post_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.moderate_community_post(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderate_community_post(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_reported_community_posts()
RETURNS TABLE (
  post_id uuid,
  body text,
  status text,
  report_count integer,
  reasons text[],
  author_name text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  RETURN QUERY
  SELECT p.id, p.body, p.status, p.report_count,
         coalesce((SELECT array_agg(r.reason ORDER BY r.created_at DESC) FILTER (WHERE r.reason IS NOT NULL)
                   FROM public.community_reports r WHERE r.post_id = p.id), '{}'),
         nullif(btrim(concat_ws(' ', a.first_name, a.last_name)), ''),
         p.created_at
  FROM public.community_posts p
  LEFT JOIN public.accounts a ON a.id = p.account_id
  WHERE p.status = 'held' OR (p.status = 'visible' AND p.report_count > 0)
  ORDER BY (p.status = 'held') DESC, p.report_count DESC, p.created_at DESC
  LIMIT 100;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_get_reported_community_posts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_reported_community_posts() TO authenticated;

-- -----------------------------------------------------------------------------
-- Urgent Text Line admin alerts: the chat webhook already alerts every admin
-- immediately. The outbox alert becomes a reminder that only fires if the
-- thread is still unread 10 minutes later (at most one per thread per admin
-- per 10 minutes), and taps open that thread.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._notify_admin_textline_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_thread public.threads%ROWTYPE;
  v_bucket text := floor(extract(epoch FROM now()) / 600)::bigint::text;
BEGIN
  IF NEW.sender_role <> 'member' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_thread FROM public.threads WHERE id = NEW.thread_id;
  IF v_thread.kind IS DISTINCT FROM 'oncall' THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.push_outbox (account_id, kind, title, body, metadata, idempotency_key, scheduled_for)
  SELECT a.id,
         'admin_textline_message',
         '💬 Unread Urgent Text Line message',
         'A member''s message has been waiting 10 minutes. Tap to reply.',
         jsonb_build_object('kind', 'admin_textline_message', 'thread_id', NEW.thread_id, 'message_at', NEW.created_at),
         'admin-textline:' || NEW.thread_id::text || ':' || a.id::text || ':' || v_bucket,
         now() + interval '10 minutes'
  FROM public.accounts a
  JOIN auth.users u ON u.id = a.user_id
  WHERE lower(coalesce(u.email, '')) = ANY (public.admin_email_list())
    AND a.push_token IS NOT NULL
    AND a.id IS DISTINCT FROM v_thread.account_id
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._notify_admin_textline_message() FROM PUBLIC, anon, authenticated;

-- Reminders for threads an admin has read (or replied to) since the member's
-- latest message are settled without sending. Compared against the thread, not
-- the row: a second message inside the same 10-minute bucket adds no row of its
-- own, so it must keep the surviving reminder alive.
CREATE OR REPLACE FUNCTION public.claim_push_outbox(p_limit integer DEFAULT 200, p_lease interval DEFAULT '00:05:00'::interval)
RETURNS SETOF public.push_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_token uuid := gen_random_uuid();
BEGIN
  IF p_limit NOT BETWEEN 1 AND 500 OR p_lease < interval '30 seconds' OR p_lease > interval '30 minutes' THEN
    RAISE EXCEPTION 'invalid_claim_parameters';
  END IF;

  UPDATE public.push_outbox o
  SET sent_at = now(), last_error = 'read_before_reminder'
  FROM public.threads t
  WHERE o.kind = 'admin_textline_message'
    AND o.sent_at IS NULL AND o.failed_at IS NULL
    AND o.scheduled_for <= now()
    AND o.metadata ? 'thread_id'
    AND t.id = (o.metadata->>'thread_id')::uuid
    AND t.last_admin_read_at >= coalesce(t.last_member_message_at, (o.metadata->>'message_at')::timestamptz);

  RETURN QUERY WITH claimed AS (
    SELECT id FROM public.push_outbox
    WHERE sent_at IS NULL AND failed_at IS NULL AND scheduled_for <= now()
      AND (processing_at IS NULL OR processing_at < now() - p_lease)
    ORDER BY scheduled_for, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ) UPDATE public.push_outbox o SET processing_at = now(), processing_token = v_token
    FROM claimed WHERE o.id = claimed.id RETURNING o.*;
END
$$;
REVOKE EXECUTE ON FUNCTION public.claim_push_outbox(integer, interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_outbox(integer, interval) TO service_role;
