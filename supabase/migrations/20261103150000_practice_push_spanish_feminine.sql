-- Spanish copy addresses the member in the feminine (nearly all are women):
-- "cuando estés lista", not "listo". Otherwise unchanged (enqueue_due_practice_pushes(timestamp with time zone)).

CREATE OR REPLACE FUNCTION public.enqueue_due_practice_pushes(p_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row record;
  v_count integer := 0;
  v_inserted boolean;
  v_event_id uuid;
BEGIN
  FOR v_row IN
    SELECT
      p.account_id,
      p.frequency_per_week,
      p.window_start_hour,
      p.window_end_hour,
      p.next_prompt_at,
      a.locale
    FROM public.practice_push_preferences p
    JOIN public.accounts a ON a.id = p.account_id
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = a.timezone) THEN a.timezone
        ELSE 'UTC'
      END AS name
    ) tz
    WHERE p.enabled
      AND p.next_prompt_at IS NOT NULL
      AND p.next_prompt_at <= p_now
      AND a.push_token IS NOT NULL
      AND extract(hour FROM (p_now AT TIME ZONE tz.name))::integer >= p.window_start_hour
      AND extract(hour FROM (p_now AT TIME ZONE tz.name))::integer < p.window_end_hour
      AND (
        (a.type = 'attached'
          AND EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = a.org_id AND o.status = 'active'))
        OR EXISTS (
          SELECT 1 FROM public.entitlements e
          WHERE e.account_id = a.id
            AND e.tier IN ('essential', 'premium', 'org')
            AND (e.expires_at IS NULL OR e.expires_at > p_now)
        )
        OR EXISTS (
          SELECT 1 FROM auth.users u
          WHERE u.id = a.user_id
            AND lower(trim(u.email)) IN ('matt@soberhelpline.com', 'matt@freedominterventions.com')
        )
      )
    ORDER BY p.next_prompt_at, p.account_id
    FOR UPDATE OF p SKIP LOCKED
  LOOP
    v_event_id := gen_random_uuid();
    INSERT INTO public.push_outbox(
      account_id, kind, title, body, metadata, idempotency_key, scheduled_for
    ) VALUES (
      v_row.account_id,
      'practice_incoming',
      CASE WHEN coalesce(v_row.locale, 'en') LIKE 'es%'
        THEN 'Llamada de práctica entrante'
        ELSE 'Incoming practice call'
      END,
      CASE WHEN coalesce(v_row.locale, 'en') LIKE 'es%'
        THEN 'Tu compañero de práctica con IA está llamando. Contesta cuando estés lista para practicar bajo presión.'
        ELSE 'Your AI practice partner is calling. Answer when you are ready to practice responding under pressure.'
      END,
      jsonb_build_object(
        'kind', 'practice_incoming',
        'screen', 'rehearsal-incoming',
        'event_id', v_event_id::text,
        'expires_at', (p_now + interval '4 hours')::text
      ),
      'practice:' || v_row.account_id::text || ':' || floor(extract(epoch FROM v_row.next_prompt_at))::bigint::text,
      p_now
    )
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    v_inserted := FOUND;
    IF v_inserted THEN
      INSERT INTO public.practice_push_events(event_id, account_id, expires_at, created_at)
      VALUES (v_event_id, v_row.account_id, p_now + interval '4 hours', p_now);
      v_count := v_count + 1;
    END IF;

    -- Deliver at most one catch-up prompt after downtime/token restoration, then
    -- fast-forward from the actual enqueue time instead of replaying a backlog.
    UPDATE public.practice_push_preferences
    SET last_enqueued_at = p_now,
        next_prompt_at = public._next_practice_prompt_at(
          v_row.account_id, v_row.frequency_per_week,
          v_row.window_start_hour, v_row.window_end_hour,
          greatest(v_row.next_prompt_at, p_now)
        )
    WHERE account_id = v_row.account_id;
  END LOOP;
  RETURN v_count;
END;
$function$;
