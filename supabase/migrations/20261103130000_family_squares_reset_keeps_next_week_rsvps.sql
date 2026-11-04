-- The Tuesday 2 AM Pacific reset deleted every undated Family Squares RSVP.
-- The live 4.1 app writes no occurrence date and, after Monday's call ends,
-- offers next Monday's call: an RSVP made Monday 8 PM-Tuesday 2 AM was
-- deleted a few hours later (and then removed from soberhelpline.com).
-- Keep undated RSVPs created after the call ended. Otherwise unchanged.

CREATE OR REPLACE FUNCTION public._family_squares_rsvp_expired(
  p_meeting_date date, p_created_at timestamptz, p_local_now timestamp)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  -- Dated (4.2+): expired once that Monday has passed. Undated (4.1): expired
  -- unless it was made after Monday's call ended (8 PM Pacific), when 4.1
  -- already offers next Monday's call and the web sync registered it there.
  SELECT CASE
    WHEN p_meeting_date IS NOT NULL THEN p_meeting_date < p_local_now::date
    ELSE p_created_at < ((p_local_now::date - 1) + time '20:00') AT TIME ZONE 'America/Los_Angeles'
  END;
$$;
REVOKE EXECUTE ON FUNCTION public._family_squares_rsvp_expired(date, timestamptz, timestamp) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reset_family_squares_weekly_rsvps()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_local_now timestamp := clock_timestamp() AT TIME ZONE 'America/Los_Angeles';
  v_deleted integer := 0;
  v_more integer := 0;
  v_links integer := 0;
BEGIN
  -- pg_cron runs in UTC. The job runs at both possible UTC offsets and this
  -- guard makes exactly the 2 AM Pacific invocation perform the reset.
  IF extract(isodow FROM v_local_now) <> 2 OR extract(hour FROM v_local_now) <> 2 THEN
    RETURN 0;
  END IF;

  DELETE FROM public.session_rsvps
  WHERE session_id = public.family_squares_session_id()
    AND public._family_squares_rsvp_expired(family_squares_meeting_date, created_at, v_local_now);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- La Sobremesa: keep members who already reserved next week's call.
  DELETE FROM public.session_rsvps r
  WHERE r.session_id = public.la_sobremesa_session_id()
    AND NOT EXISTS (
      SELECT 1 FROM public.session_join_links l
      WHERE l.session_id = r.session_id AND l.account_id = r.account_id
        AND l.starts_at > clock_timestamp()
    );
  GET DIAGNOSTICS v_more = ROW_COUNT;

  DELETE FROM public.session_join_links WHERE starts_at < clock_timestamp();
  GET DIAGNOSTICS v_links = ROW_COUNT;
  RETURN v_deleted + v_more + v_links;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reset_family_squares_weekly_rsvps() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_family_squares_weekly_rsvps() TO service_role;
