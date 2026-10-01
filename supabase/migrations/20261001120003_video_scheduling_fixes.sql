-- Private video scheduling fixes.
-- 1. member_accept_video_proposal copied the coach's proposal timezone onto
--    requested_timezone, so the member's own timezone (used for her reminders,
--    confirmations and session display) was lost. It is now kept.
-- 2. member_accept_video_proposal and coach_confirm_video_session accepted a
--    start time that had already passed; both now raise start_time_in_past.
-- 3. Member video notifications were English-only and called one-off ($150)
--    plan reviews "Premier". _video_push now localizes every member_* kind
--    from accounts.locale ('es%' → Spanish) and uses neutral wording for
--    one-off and organization sessions; the reminder job does the same.
-- Latest definitions: 20260712120000_premier_video_scheduling.sql and
-- 20260712130000_premier_video_notifications_calendar.sql (grants are kept by
-- CREATE OR REPLACE and restated below).

CREATE OR REPLACE FUNCTION public.member_accept_video_proposal(p_session_id uuid, p_proposal_id uuid, p_expected_version integer)
 RETURNS video_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_actor uuid:=my_account_id(); v_row video_sessions; v_prop video_session_proposals; v_old text;
BEGIN
 SELECT * INTO v_row FROM video_sessions WHERE id=p_session_id AND account_id=v_actor FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF; PERFORM _video_assert_version(v_row.version,p_expected_version);
 SELECT * INTO v_prop FROM video_session_proposals WHERE id=p_proposal_id AND session_id=v_row.id AND status='pending' AND proposed_by_role='coach' FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'proposal_not_found'; END IF;
 IF v_prop.starts_at <= now() THEN RAISE EXCEPTION 'start_time_in_past' USING ERRCODE = '22023'; END IF;
 PERFORM _video_assert_coach_available(v_prop.coach_id,v_row.id,v_prop.starts_at,v_prop.duration_minutes); v_old:=v_row.status;
 UPDATE video_session_proposals SET status=CASE WHEN id=v_prop.id THEN 'accepted' ELSE 'superseded' END,responded_at=now() WHERE session_id=v_row.id AND status='pending';
 -- requested_timezone stays the member's own timezone; the proposal's zone is
 -- the coach's and is kept on the proposal row.
 UPDATE video_sessions SET assigned_coach_id=v_prop.coach_id,scheduled_for=v_prop.starts_at,duration_minutes=v_prop.duration_minutes,status='scheduled',calendar_sync_status='pending',calendar_sync_error=NULL,version=version+1 WHERE id=v_row.id RETURNING * INTO v_row;
 PERFORM _video_event(v_row,v_actor,'member','proposal_accepted',v_old,jsonb_build_object('proposal_id',v_prop.id)); PERFORM _video_push(v_prop.coach_id,'coach_video_accepted','Video proposal accepted','A member accepted your proposed video time.',v_row.id,v_row.version,'accepted'); RETURN v_row;
END $function$;

CREATE OR REPLACE FUNCTION public.coach_confirm_video_session(p_session_id uuid, p_expected_version integer, p_coach_id uuid DEFAULT NULL::uuid)
 RETURNS video_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_actor uuid := my_account_id(); v_row video_sessions; v_old text;
BEGIN
  IF NOT is_video_staff(v_actor) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO v_row FROM video_sessions WHERE id=p_session_id FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found'; END IF;
  PERFORM _video_assert_version(v_row.version,p_expected_version); IF v_row.status <> 'requested' THEN RAISE EXCEPTION 'invalid_transition'; END IF;
  -- A request whose time has passed needs a counteroffer, not a confirmation.
  IF v_row.requested_start <= now() THEN RAISE EXCEPTION 'start_time_in_past' USING ERRCODE = '22023'; END IF;
  v_old:=v_row.status; v_row.assigned_coach_id:=COALESCE(p_coach_id,v_actor);
  PERFORM _video_assert_coach_available(v_row.assigned_coach_id,v_row.id,v_row.requested_start,v_row.duration_minutes);
  UPDATE video_session_proposals SET status='accepted',responded_at=now() WHERE session_id=v_row.id AND status='pending';
  UPDATE video_sessions SET assigned_coach_id=v_row.assigned_coach_id,scheduled_for=requested_start,status='scheduled',calendar_sync_status='pending',calendar_sync_error=NULL,version=version+1 WHERE id=v_row.id RETURNING * INTO v_row;
  PERFORM _video_event(v_row,v_actor,'coach','confirmed',v_old); PERFORM _video_push(v_row.account_id,'member_video_scheduled','Video session confirmed','Your Premier video session was confirmed.',v_row.id,v_row.version,'confirmed'); RETURN v_row;
END $function$;

REVOKE EXECUTE ON FUNCTION public.member_accept_video_proposal(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_accept_video_proposal(uuid, uuid, integer) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.coach_confirm_video_session(uuid, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coach_confirm_video_session(uuid, integer, uuid) TO authenticated, service_role;

-- ── Localized member copy ─────────────────────────────────────────────────
-- p_neutral: a one-off plan review or an organization member is not on
-- Premier, so the copy says "video session" instead of "Premier video session".
CREATE OR REPLACE FUNCTION public._video_member_push_copy(
  p_kind text, p_event text, p_spanish boolean, p_neutral boolean, p_when text,
  OUT title text, OUT body text)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_en text := CASE WHEN p_neutral THEN 'video session' ELSE 'Premier video session' END;
  v_es text := CASE WHEN p_neutral THEN 'sesión de video' ELSE 'sesión de video Premier' END;
BEGIN
  IF p_kind = 'member_video_scheduled' THEN
    IF p_spanish THEN
      title := 'Sesión de video confirmada';
      body := 'Tu ' || v_es || CASE WHEN p_when IS NULL THEN ' quedó confirmada.' ELSE ' quedó confirmada para el ' || p_when || '.' END;
    ELSE
      title := 'Video session confirmed';
      body := 'Your ' || v_en || CASE WHEN p_when IS NULL THEN ' was confirmed.' ELSE ' is confirmed for ' || p_when || '.' END;
    END IF;
  ELSIF p_kind = 'member_video_counteroffer' THEN
    IF p_spanish THEN
      title := 'Tu coach propuso otro horario';
      body := 'Tu coach propuso un nuevo horario para tu ' || v_es || '. Abre Sober Helpline para aceptarlo o pedir otro.';
    ELSE
      title := 'New video time proposed';
      body := 'Your coach proposed a new time for your ' || v_en || '. Open Sober Helpline to accept it or ask for another.';
    END IF;
  ELSIF p_kind = 'member_video_live' THEN
    IF p_spanish THEN
      title := 'Tu sesión de video está comenzando';
      body := 'Abre Sober Helpline para unirte a tu ' || v_es || '.';
    ELSE
      title := 'Your video session is starting';
      body := 'Open Sober Helpline to join your ' || v_en || '.';
    END IF;
  ELSIF p_kind = 'member_video_completed' THEN
    IF p_spanish THEN
      title := 'Sesión de video completada';
      body := 'Tu ' || v_es || ' quedó marcada como completada.';
    ELSE
      title := 'Video session complete';
      body := 'Your ' || v_en || ' is marked complete.';
    END IF;
  ELSIF p_kind = 'member_video_no_show' THEN
    IF p_spanish THEN
      title := 'Sesión de video actualizada';
      body := 'Tu ' || v_es || ' se actualizó. Abre Sober Helpline para ver los detalles.';
    ELSE
      title := 'Video session updated';
      body := 'Your ' || v_en || ' was updated. Open Sober Helpline for details.';
    END IF;
  ELSIF p_kind = 'member_video_cancelled' AND p_event = 'payment_refunded' THEN
    IF p_spanish THEN
      title := 'Revisión del plan cancelada';
      body := 'Te reembolsamos el pago de la revisión del plan y la sesión quedó cancelada.';
    ELSE
      title := 'Plan review cancelled';
      body := 'Your plan-review payment was refunded and the session was cancelled.';
    END IF;
  ELSIF p_kind = 'member_video_cancelled' THEN
    IF p_spanish THEN
      title := 'Sesión de video cancelada';
      body := 'Tu ' || v_es || ' fue cancelada.';
    ELSE
      title := 'Video session cancelled';
      body := 'Your ' || v_en || ' was cancelled.';
    END IF;
  ELSIF p_kind = 'member_plan_update_requested' THEN
    IF p_spanish THEN
      title := 'Tu coach pidió un plan actualizado';
      body := 'Tu coach te pidió una versión actualizada de tu plan antes de la reunión.';
    ELSE
      title := 'Plan update requested';
      body := 'Your coach requested an updated plan before your meeting.';
    END IF;
  END IF;
END
$$;

REVOKE EXECUTE ON FUNCTION public._video_member_push_copy(text, text, boolean, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._video_member_push_copy(text, text, boolean, boolean, text) TO service_role;

-- Formats an instant for a member push in her zone: "Tue, Oct 6 at 3:00 PM
-- (America/Chicago)" or "6/10 a las 15:00 (America/Chicago)".
CREATE OR REPLACE FUNCTION public._video_push_when(p_at timestamptz, p_timezone text, p_spanish boolean)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN p_at IS NULL THEN NULL ELSE
    to_char(p_at AT TIME ZONE z.name,
      CASE WHEN p_spanish THEN 'FMDD/FMMM "a las" FMHH24:MI' ELSE 'FMDy, FMMon FMDD "at" FMHH12:MI AM' END)
    || ' (' || z.name || ')' END
  FROM (SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone)
                    THEN p_timezone ELSE 'UTC' END AS name) z
$$;

REVOKE EXECUTE ON FUNCTION public._video_push_when(timestamptz, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._video_push_when(timestamptz, text, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public._video_push(p_account uuid, p_kind text, p_title text, p_body text, p_session uuid, p_version integer, p_event text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_title text := p_title;
  v_body text := p_body;
  v_session video_sessions;
  v_spanish boolean := false;
  v_neutral boolean := false;
  v_copy_title text;
  v_copy_body text;
BEGIN
  SELECT * INTO v_session FROM video_sessions WHERE id = p_session;
  IF FOUND THEN
    v_neutral := v_session.appointment_type = 'one_off_150' OR v_session.member_tier_at_booking = 'organization';
  END IF;

  IF p_kind LIKE 'member\_%' THEN
    -- Members get their own language; callers' English text is the fallback
    -- for any kind without localized copy.
    SELECT COALESCE(a.locale, 'en') LIKE 'es%' INTO v_spanish FROM accounts a WHERE a.id = p_account;
    SELECT c.title, c.body INTO v_copy_title, v_copy_body
    FROM public._video_member_push_copy(p_kind, p_event, COALESCE(v_spanish, false), v_neutral,
      CASE WHEN p_kind = 'member_video_scheduled'
        THEN public._video_push_when(v_session.scheduled_for, v_session.requested_timezone, COALESCE(v_spanish, false))
      END) c;
    IF v_copy_title IS NOT NULL THEN
      v_title := v_copy_title;
      v_body := v_copy_body;
    END IF;
  ELSIF v_neutral THEN
    -- Staff copy stays English; a one-off review is not a Premier session.
    v_title := replace(v_title, 'Premier ', '');
    v_body := replace(v_body, 'Premier ', '');
  END IF;

  INSERT INTO push_outbox(account_id, kind, title, body, metadata, idempotency_key)
  VALUES(p_account, p_kind, v_title, v_body,
    jsonb_build_object('kind', p_kind, 'deep_link', 'soberhelpline://premier-video/' || p_session::text, 'screen', 'premier-video', 'session_id', p_session, 'event', p_event),
    'video:' || p_session::text || ':' || p_version::text || ':' || p_event)
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
END $function$;

REVOKE EXECUTE ON FUNCTION public._video_push(uuid, text, text, text, uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._video_push(uuid, text, text, text, uuid, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_premier_video_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_session video_sessions;
  v_target uuid;
  v_window text;
  v_count integer := 0;
  v_member boolean;
  v_spanish boolean;
  v_neutral boolean;
  v_kind text;
  v_when text;
  v_title text;
  v_body text;
BEGIN
  FOR v_session IN
    SELECT s.*
    FROM video_sessions s
    WHERE s.status = 'scheduled'
      AND s.scheduled_for IS NOT NULL
      AND s.assigned_coach_id IS NOT NULL
      AND s.scheduled_for > now()
      AND (
        s.scheduled_for BETWEEN now() + interval '23 hours 55 minutes' AND now() + interval '24 hours 5 minutes'
        OR s.scheduled_for BETWEEN now() + interval '55 minutes' AND now() + interval '65 minutes'
      )
  LOOP
    v_window := CASE
      WHEN v_session.scheduled_for > now() + interval '2 hours' THEN '24h'
      ELSE '1h'
    END;
    v_neutral := v_session.appointment_type = 'one_off_150' OR v_session.member_tier_at_booking = 'organization';

    FOREACH v_target IN ARRAY ARRAY[v_session.account_id, v_session.assigned_coach_id]
    LOOP
      v_member := v_target = v_session.account_id;
      v_kind := CASE WHEN v_member THEN 'premier_video_reminder' ELSE 'coach_video_reminder' END;
      v_spanish := false;
      IF v_member THEN
        SELECT COALESCE(a.locale, 'en') LIKE 'es%' INTO v_spanish FROM accounts a WHERE a.id = v_target;
        v_spanish := COALESCE(v_spanish, false);
      END IF;
      v_when := public._video_push_when(v_session.scheduled_for, v_session.requested_timezone, v_spanish);

      IF v_spanish THEN
        v_title := CASE WHEN v_window = '24h' THEN 'Tu sesión de video es mañana' ELSE 'Tu sesión de video es en una hora' END;
        v_body := 'Tu ' || CASE WHEN v_neutral THEN 'sesión de video' ELSE 'sesión de video Premier' END
          || CASE WHEN v_window = '24h' THEN ' es mañana, el ' ELSE ' es en aproximadamente una hora, el ' END
          || v_when || '.';
      ELSE
        v_title := CASE WHEN v_neutral THEN 'Video session' ELSE 'Premier video session' END
          || CASE WHEN v_window = '24h' THEN ' tomorrow' ELSE ' in one hour' END;
        v_body := CASE WHEN v_member THEN 'Your ' ELSE 'The ' END
          || CASE WHEN v_neutral THEN 'video session' ELSE 'Premier video session' END
          || CASE WHEN v_window = '24h' THEN ' is tomorrow, ' ELSE ' is in about one hour, ' END
          || v_when || '.';
      END IF;

      INSERT INTO push_outbox(account_id, kind, title, body, metadata, idempotency_key, scheduled_for)
      VALUES (
        v_target,
        v_kind,
        v_title,
        v_body,
        jsonb_build_object(
          'kind', v_kind,
          'session_id', v_session.id,
          'event', 'reminder_' || v_window,
          'screen', CASE WHEN v_member THEN 'support' ELSE 'admin' END
        ),
        'video:' || v_session.id::text || ':' || v_session.version::text || ':reminder:' || v_window || ':' || v_target::text,
        now()
      )
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
      IF FOUND THEN v_count := v_count + 1; END IF;
    END LOOP;
  END LOOP;
  RETURN v_count;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.enqueue_premier_video_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_premier_video_reminders() TO service_role;
