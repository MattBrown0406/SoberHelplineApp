-- =============================================================================
-- Situation briefs label each check-in with the member's own day.
--
-- The brief grouped check-ins by their UTC date, so an evening check-in in
-- the Americas showed up in Matt's brief under the next day. checkins already
-- stores checkin_date in the member's timezone.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.build_situation_brief_sections(p_account uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mood      jsonb;
  v_tracker   jsonb;
  v_walls     jsonb;
  v_loved_one jsonb;
  v_rehearsal jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'day',          to_char(checkin_date, 'YYYY-MM-DD'),
           'mood',         mood,
           'capacity',     capacity,
           'pressure',     pressure,
           'support_need', support_need,
           'note',         note
         ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_mood
  FROM (
    SELECT created_at, checkin_date, mood, capacity, pressure, support_need, note
    FROM checkins
    WHERE account_id = p_account
      AND created_at >= now() - interval '7 days'
    ORDER BY created_at DESC
    LIMIT 7
  ) c;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'sign_key', sign_key,
           'kind',     kind,
           'week',     to_char(week, 'YYYY-MM-DD')
         ) ORDER BY week DESC, sign_key), '[]'::jsonb)
  INTO v_tracker
  FROM (
    SELECT sign_key, kind, week
    FROM tracker_logs
    WHERE account_id = p_account
      AND week >= (CURRENT_DATE - 14)
    ORDER BY week DESC, sign_key
    LIMIT 40
  ) t;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'text',       text,
           'anchor',     anchor,
           'created_at', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
         ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_walls
  FROM (
    SELECT text, anchor, created_at
    FROM walls
    WHERE account_id = p_account
    ORDER BY created_at DESC
    LIMIT 8
  ) w;

  SELECT to_jsonb(lo) - 'id' - 'account_id' - 'created_at' - 'updated_at'
  INTO v_loved_one
  FROM loved_ones lo
  WHERE lo.account_id = p_account;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'created_at', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
           'scores',     debrief -> 'scores'
         ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_rehearsal
  FROM (
    SELECT created_at, debrief
    FROM rehearsal_sessions
    WHERE account_id = p_account
      AND debrief IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 3
  ) r;

  RETURN jsonb_build_object(
    'mood',         v_mood,
    'tracker',      v_tracker,
    'boundaries',   v_walls,
    'loved_one',    coalesce(v_loved_one, 'null'::jsonb),
    'rehearsal',    v_rehearsal,
    'generated_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
END;
$function$
;

REVOKE EXECUTE ON FUNCTION public.build_situation_brief_sections(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.build_situation_brief_sections(uuid) TO service_role;
