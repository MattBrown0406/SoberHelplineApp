-- Reliable moderated-group RSVP and live push delivery.
-- Pushes are created atomically with the false -> true host transition and
-- delivered through the leased/retryable push_outbox drain. No public webhook.

ALTER TABLE public.group_hosts
  ADD COLUMN IF NOT EXISTS live_event_id uuid,
  ADD COLUMN IF NOT EXISTS live_started_at timestamptz;

-- Ordinary members may read and mutate only their own RSVP rows for the four
-- configured rooms. Direct writes remain temporarily compatible with installed
-- clients; the validated RPC below is the preferred path for new clients.
DROP POLICY IF EXISTS "own_group_rsvps" ON public.group_rsvps;
DROP POLICY IF EXISTS "group_rsvps: own select" ON public.group_rsvps;
DROP POLICY IF EXISTS "group_rsvps: compatible insert" ON public.group_rsvps;
DROP POLICY IF EXISTS "group_rsvps: compatible update" ON public.group_rsvps;
DROP POLICY IF EXISTS "group_rsvps: compatible delete" ON public.group_rsvps;
CREATE POLICY "group_rsvps: own select" ON public.group_rsvps
  FOR SELECT TO authenticated
  USING (account_id = public.my_account_id());
CREATE POLICY "group_rsvps: compatible insert" ON public.group_rsvps
  FOR INSERT TO authenticated
  WITH CHECK (
    account_id = public.my_account_id()
    AND room_name IN ('shp-parents', 'shp-spouses', 'shp-boundaries', 'shp-treatment')
  );
CREATE POLICY "group_rsvps: compatible update" ON public.group_rsvps
  FOR UPDATE TO authenticated
  USING (account_id = public.my_account_id())
  WITH CHECK (
    account_id = public.my_account_id()
    AND room_name IN ('shp-parents', 'shp-spouses', 'shp-boundaries', 'shp-treatment')
  );
CREATE POLICY "group_rsvps: compatible delete" ON public.group_rsvps
  FOR DELETE TO authenticated
  USING (account_id = public.my_account_id());

REVOKE ALL ON public.group_rsvps FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.group_rsvps TO authenticated;

CREATE OR REPLACE FUNCTION public.set_group_rsvp(
  p_room_name text,
  p_enabled boolean
)
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

REVOKE ALL ON FUNCTION public.set_group_rsvp(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_group_rsvp(text, boolean) TO authenticated;

-- Only the authenticated owner of a configured host row may change its live
-- state. Starting a new broadcast creates a fresh event UUID and queues one
-- idempotent outbox row for every subscriber in the same transaction.
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

    -- Wake the dispatcher immediately. The five-minute cron remains the durable
    -- fallback if this request cannot be scheduled or delivery is transient.
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

-- The old token-returning helper is no longer needed by an Edge Function and
-- exposed more data than the outbox architecture requires.
DROP FUNCTION IF EXISTS public.get_group_rsvp_push_tokens(text);
