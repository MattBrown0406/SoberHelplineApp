-- Follow-up for production: serialize Go Live against RSVP writes and correct
-- the registered application deep-link scheme for future group-live pushes.

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
    AND lower(u.email) = 'matt@soberhelpline.com'
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
