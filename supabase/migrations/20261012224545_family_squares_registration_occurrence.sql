-- Confirmed occurrence snapshot; legacy going rows are deliberately not backfilled.
ALTER TABLE public.session_rsvps ADD COLUMN family_squares_meeting_date date;

-- The snapshot is service-written. Existing RSVP permissions/cancellation stay intact.
CREATE OR REPLACE FUNCTION public._protect_family_squares_occurrence()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') IN ('anon', 'authenticated') THEN
    NEW.family_squares_meeting_date := CASE WHEN TG_OP = 'UPDATE' THEN OLD.family_squares_meeting_date ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._protect_family_squares_occurrence() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER protect_family_squares_occurrence BEFORE INSERT OR UPDATE ON public.session_rsvps
  FOR EACH ROW EXECUTE FUNCTION public._protect_family_squares_occurrence();

-- Preserve next Monday's English registration made after the previous call.
CREATE OR REPLACE FUNCTION public.reset_family_squares_weekly_rsvps()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    AND (family_squares_meeting_date IS NULL OR family_squares_meeting_date < v_local_now::date);
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
$$;
REVOKE EXECUTE ON FUNCTION public.reset_family_squares_weekly_rsvps() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_family_squares_weekly_rsvps() TO service_role;
