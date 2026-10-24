-- Production's Premier video reschedule functions were rewritten outside the
-- migrations with two guards the repo lacked: the coach reschedule checks
-- video staff and a missing session itself, and the member reschedule rejects
-- notes over 2,000 characters. Capture production's definitions verbatim so
-- the repo, local tests and production agree. No behavior change on production.

CREATE OR REPLACE FUNCTION public.coach_reschedule_video_session(p_session_id uuid, p_expected_version integer, p_starts_at timestamp with time zone, p_timezone text, p_duration_minutes integer, p_note text DEFAULT NULL::text)
 RETURNS video_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := public.my_account_id();
  v_assigned_coach uuid;
BEGIN
  IF NOT public.is_video_staff(v_actor) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT assigned_coach_id
  INTO v_assigned_coach
  FROM public.video_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;

  IF v_assigned_coach IS NULL THEN
    RAISE EXCEPTION 'assigned_coach_required';
  END IF;

  RETURN public.coach_counteroffer_video_session(
    p_session_id,
    p_expected_version,
    p_starts_at,
    p_timezone,
    p_duration_minutes,
    p_note,
    v_assigned_coach
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.member_reschedule_video_session(p_session_id uuid, p_expected_version integer, p_starts_at timestamp with time zone, p_timezone text, p_duration_minutes integer, p_note text DEFAULT NULL::text)
 RETURNS video_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := public.my_account_id();
  v_row public.video_sessions;
BEGIN
  PERFORM public._video_assert_timezone(p_timezone);

  SELECT *
  INTO v_row
  FROM public.video_sessions
  WHERE id = p_session_id
    AND account_id = v_actor
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found';
  END IF;

  PERFORM public._video_assert_version(
    v_row.version,
    p_expected_version
  );

  IF v_row.status NOT IN ('requested', 'scheduled')
     OR p_starts_at <= now()
     OR p_duration_minutes NOT BETWEEN 15 AND 240
     OR length(COALESCE(p_note, '')) > 2000
  THEN
    RAISE EXCEPTION 'invalid_transition';
  END IF;

  UPDATE public.video_session_proposals
  SET
    status = 'superseded',
    responded_at = now()
  WHERE session_id = v_row.id
    AND status = 'pending';

  INSERT INTO public.video_session_proposals (
    session_id,
    proposed_by_account_id,
    proposed_by_role,
    coach_id,
    starts_at,
    timezone,
    duration_minutes,
    note
  )
  VALUES (
    v_row.id,
    v_actor,
    'member',
    v_row.assigned_coach_id,
    p_starts_at,
    p_timezone,
    p_duration_minutes,
    NULLIF(btrim(p_note), '')
  );

  UPDATE public.video_sessions
  SET
    requested_start = p_starts_at,
    requested_timezone = p_timezone,
    duration_minutes = p_duration_minutes,
    member_note = NULLIF(btrim(p_note), ''),
    scheduled_for = NULL,
    status = 'requested',
    calendar_sync_status =
      CASE
        WHEN calendar_event_id IS NULL
          THEN 'not_synced'
        ELSE 'pending'
      END,
    calendar_sync_error = NULL,
    version = version + 1
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  PERFORM public._video_event(
    v_row,
    v_actor,
    'member',
    'reschedule_requested',
    NULL
  );

  IF v_row.assigned_coach_id IS NOT NULL THEN
    PERFORM public._video_push(
      v_row.assigned_coach_id,
      'coach_video_reschedule',
      'Video reschedule requested',
      'A member requested a new Premier video time.',
      v_row.id,
      v_row.version,
      'reschedule_requested'
    );
  END IF;

  RETURN v_row;
END;
$function$;
