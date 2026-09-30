-- =============================================================================
-- Live groups and family walls.
--
-- 1. group_hosts.is_live was only cleared by the host's own "end" call. If the
--    host's app died mid-broadcast the flag stuck: members saw an empty room as
--    live indefinitely, and the next real go-live was treated as a no-op, so
--    nobody who RSVP'd was notified. A go-live on a flag older than 3 hours now
--    starts a new event, and readers ignore flags that old.
-- 2. Go-live pushes invited free accounts into a room the token service
--    (correctly) refuses them; only members are notified now.
-- 3. Deleting an account deleted every shared family wall that member had
--    proposed, along with everyone else's commitments to it, although the
--    family space itself is meant to survive its members. Walls now outlive
--    their proposer.
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

ALTER TABLE public.shared_walls ALTER COLUMN proposed_by DROP NOT NULL;
ALTER TABLE public.shared_walls
  DROP CONSTRAINT IF EXISTS shared_walls_proposed_by_fkey,
  ADD CONSTRAINT shared_walls_proposed_by_fkey
    FOREIGN KEY (proposed_by) REFERENCES public.accounts(id) ON DELETE SET NULL;
