-- Provider (attached) accounts are only paid while their organization is
-- active — has_active_textline_access / has_active_private_video_access
-- already say so (20260930230000_second_audit_pass.sql). The practice-call
-- scheduler and its delivery TTL still treated every attached account as
-- paid, and the plan-review request labelled any attached account as an
-- organization booking. Bodies below are the latest definitions
-- (20260728205914_practice_push_notifications.sql and
-- 20260930230000 / 20260714 plan-review migrations) with only that predicate
-- changed (plus a member-readable payment-record label for one-off reviews).

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
        THEN 'Tu compañero de práctica con IA está llamando. Contesta cuando estés listo para practicar bajo presión.'
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

REVOKE EXECUTE ON FUNCTION public.enqueue_due_practice_pushes(timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_due_practice_pushes(timestamp with time zone) TO service_role;

CREATE OR REPLACE FUNCTION public.practice_push_delivery_ttl(p_event_id uuid, p_account_id uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM public.practice_push_events pe
    JOIN public.practice_push_preferences pp ON pp.account_id = pe.account_id
    JOIN public.accounts a ON a.id = pe.account_id
    WHERE pe.event_id = p_event_id
      AND pe.account_id = p_account_id
      AND pe.expires_at > now()
      AND pe.answered_at IS NULL
      AND pp.enabled
      AND a.push_token IS NOT NULL
      AND (
        (a.type = 'attached'
          AND EXISTS (SELECT 1 FROM public.orgs o WHERE o.id = a.org_id AND o.status = 'active'))
        OR EXISTS (
          SELECT 1 FROM public.entitlements e
          WHERE e.account_id = a.id
            AND e.tier IN ('essential', 'premium', 'org')
            AND (e.expires_at IS NULL OR e.expires_at > now())
        )
        OR EXISTS (
          SELECT 1 FROM auth.users u
          WHERE u.id = a.user_id
            AND lower(trim(u.email)) IN ('matt@soberhelpline.com', 'matt@freedominterventions.com')
        )
      )
  ) THEN greatest(1, least(14400, floor(extract(epoch FROM (
    (SELECT expires_at FROM public.practice_push_events
     WHERE event_id = p_event_id AND account_id = p_account_id) - now()
  )))::integer)) ELSE NULL END;
$function$;

REVOKE EXECUTE ON FUNCTION public.practice_push_delivery_ttl(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.practice_push_delivery_ttl(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.request_plan_review_video_session(p_starts_at timestamp with time zone, p_timezone text, p_duration_minutes integer, p_purpose text, p_focus_reason text, p_questions jsonb, p_selected_sections text[], p_snapshot jsonb, p_consent_text text, p_consent_locale text, p_payment_choice text DEFAULT 'membership_included'::text)
 RETURNS video_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account uuid:=my_account_id(); v_row video_sessions; v_owner uuid;
  v_tier text; v_appointment text; v_payment text; v_coaching uuid;
BEGIN
  IF v_account IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  PERFORM _video_assert_timezone(p_timezone);
  IF p_starts_at IS NULL OR p_starts_at<=now() OR p_duration_minutes NOT BETWEEN 15 AND 240
    OR p_purpose <> 'plan_review'
    OR p_selected_sections IS NULL OR cardinality(p_selected_sections)=0
    OR cardinality(p_selected_sections)<>(SELECT count(DISTINCT section_key) FROM unnest(p_selected_sections) AS section_key)
    OR NOT p_selected_sections <@ ARRAY['situation','risk','safetyPlan','boundaries','incidents','familyRoles']::text[]
    OR p_snapshot IS NULL OR jsonb_typeof(p_snapshot)<>'object' OR octet_length(p_snapshot::text)>100000
    OR COALESCE(p_snapshot->>'schemaVersion','')<>'1'
    OR NOT (p_snapshot ? 'sections')
    OR jsonb_typeof(p_snapshot->'sections')<>'object'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_snapshot->'sections') k WHERE NOT k=ANY(p_selected_sections))
    OR NOT p_selected_sections <@ ARRAY(SELECT jsonb_object_keys(p_snapshot->'sections'))
    OR p_questions IS NULL OR jsonb_typeof(p_questions)<>'array' OR jsonb_array_length(p_questions)>10
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_questions) question WHERE jsonb_typeof(question)<>'string' OR length(question#>>'{}')>1000)
    OR length(COALESCE(p_focus_reason,''))>2000
    OR p_consent_text IS NULL OR length(p_consent_text) NOT BETWEEN 20 AND 1000
    OR p_consent_locale NOT IN ('en','es') THEN
    RAISE EXCEPTION 'invalid_plan_review_request';
  END IF;

  IF has_active_private_video_access(v_account) THEN
    -- 'organization' only while the provider organization is active; an
    -- attached account of a suspended org that has its own Premier is Premier.
    v_tier:=CASE WHEN EXISTS(
        SELECT 1 FROM accounts a JOIN orgs o ON o.id=a.org_id
        WHERE a.id=v_account AND a.type='attached' AND o.status='active')
      THEN 'organization' ELSE 'premier' END;
    v_appointment:='membership_included'; v_payment:='included';
  ELSIF EXISTS (SELECT 1 FROM entitlements e WHERE e.account_id=v_account AND e.tier='essential' AND (e.expires_at IS NULL OR e.expires_at>now())) THEN
    IF p_payment_choice<>'one_off_150' THEN RAISE EXCEPTION 'premier_upgrade_or_payment_required'; END IF;
    v_tier:='essential'; v_appointment:='one_off_150'; v_payment:='pending_payment';
    -- Staff-facing payment record; the requested time is written in the
    -- member's own zone rather than as a raw UTC timestamp.
    INSERT INTO coaching_bookings(account_id,preferred_times,note,status,payment_status,rate_cents)
    VALUES(v_account,to_char(p_starts_at AT TIME ZONE p_timezone,'YYYY-MM-DD HH24:MI')||' ('||p_timezone||')','Plan review video session','requested','unpaid',15000)
    RETURNING id INTO v_coaching;
  ELSE
    RAISE EXCEPTION 'essential_or_premier_required';
  END IF;

  INSERT INTO video_sessions(account_id,room_name,status,requested_start,requested_timezone,duration_minutes,
    member_note,booking_purpose,member_tier_at_booking,appointment_type,payment_status,coaching_booking_id,
    focus_reason,member_questions,selected_plan_sections,plan_snapshot,plan_snapshot_hash,snapshot_created_at,
    consent_version,consent_text,consent_locale,consented_at)
  VALUES(v_account,'premium-video-'||gen_random_uuid(),'requested',p_starts_at,p_timezone,p_duration_minutes,
    NULLIF(btrim(p_focus_reason),''),'plan_review',v_tier,v_appointment,v_payment,v_coaching,
    NULLIF(btrim(p_focus_reason),''),p_questions,p_selected_sections,p_snapshot,
    encode(extensions.digest(convert_to(p_snapshot::text,'UTF8'),'sha256'),'hex'),now(),
    'plan-review-v1',p_consent_text,p_consent_locale,now()) RETURNING * INTO v_row;
  INSERT INTO video_session_proposals(session_id,proposed_by_account_id,proposed_by_role,starts_at,timezone,duration_minutes,note)
  VALUES(v_row.id,v_account,'member',p_starts_at,p_timezone,p_duration_minutes,NULLIF(btrim(p_focus_reason),''));
  PERFORM _video_event(v_row,v_account,'member','plan_review_requested',NULL,jsonb_build_object('appointment_type',v_appointment,'payment_status',v_payment));
  FOR v_owner IN SELECT account_id FROM video_staff_roles WHERE active LOOP
    PERFORM _video_push(v_owner,'admin_video_request','New plan review request','A member submitted a private plan-review request.',v_row.id,v_row.version,'plan_review_requested');
  END LOOP;
  RETURN v_row;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'active_session_exists' USING ERRCODE='23505';
END $function$;

REVOKE EXECUTE ON FUNCTION public.request_plan_review_video_session(timestamp with time zone, text, integer, text, text, jsonb, text[], jsonb, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_plan_review_video_session(timestamp with time zone, text, integer, text, text, jsonb, text[], jsonb, text, text, text) TO authenticated, service_role;
