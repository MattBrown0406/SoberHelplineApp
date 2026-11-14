-- Family Squares: "Save my seat every Monday" and "Can't make it this week".
--
-- RSVPs are cleared every Tuesday at 2 AM Pacific, so a member who comes every
-- week had to save her seat again every week, and nobody could take an RSVP
-- back.
--
-- 1. accounts.family_squares_weekly_seat (off by default). She turns it on or
--    off herself with set_family_squares_weekly_seat().
-- 2. decline_family_squares_rsvp(): her "going" becomes "declined" for this
--    week's meeting. The reminder pushes already skip a declined RSVP (the
--    hour-before and 15-minute reminders need "going"; the 30-minute invite
--    skips "going" and "declined"), and the website already hears "declined".
--    Saving her spot again (family-squares-register) turns it back to "going".
-- 3. The weekly reset, after clearing last week's RSVPs, saves next Monday's
--    seat for every member with the preference on. The row looks exactly like
--    one family-squares-register writes (going, dated, created now), so the
--    reminders and the 15-minute website sync treat it like any RSVP. A
--    decline is cleared with the rest on Tuesday, so it lasts one week only.
--    The reset also records the finished meeting's RSVP counts first
--    (20261114110000).

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS family_squares_weekly_seat boolean NOT NULL DEFAULT false;

-- She reads her own preference (the accounts RLS policy limits rows to her own).
GRANT SELECT (family_squares_weekly_seat) ON public.accounts TO authenticated;

CREATE OR REPLACE FUNCTION public.set_family_squares_weekly_seat(p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'invalid_preference' USING ERRCODE = '22023';
  END IF;
  UPDATE public.accounts SET family_squares_weekly_seat = p_enabled WHERE id = public.my_account_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_account' USING ERRCODE = '28000';
  END IF;
  RETURN p_enabled;
END;
$$;
REVOKE ALL ON FUNCTION public.set_family_squares_weekly_seat(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_family_squares_weekly_seat(boolean) TO authenticated;

-- True when a saved seat was changed to "can't make it". Only her own RSVP,
-- only for Family Squares; the meeting date on the row is left as it is.
CREATE OR REPLACE FUNCTION public.decline_family_squares_rsvp()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := public.my_account_id();
  v_session uuid := public.family_squares_session_id();
BEGIN
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'no_account' USING ERRCODE = '28000';
  END IF;
  IF v_session IS NULL THEN RETURN false; END IF;
  UPDATE public.session_rsvps SET status = 'declined'
  WHERE session_id = v_session AND account_id = v_account AND status = 'going';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.decline_family_squares_rsvp() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_family_squares_rsvp() TO authenticated;

-- Saves p_meeting_date's seat for every member who asked for one every Monday.
-- The same people family-squares-register accepts: a verified email on a real
-- (not anonymous, not deleted) sign-in. Spanish members are invited to
-- La Sobremesa and cannot see Family Squares, so they are skipped. A member
-- who already answered for that meeting (going or declined) keeps her answer.
CREATE OR REPLACE FUNCTION public._family_squares_restore_weekly_seats(p_meeting_date date)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_session uuid := public.family_squares_session_id();
  v_count integer := 0;
BEGIN
  IF v_session IS NULL OR p_meeting_date IS NULL THEN RETURN 0; END IF;
  INSERT INTO public.session_rsvps (session_id, account_id, status, family_squares_meeting_date, created_at)
  SELECT v_session, a.id, 'going', p_meeting_date, now()
  FROM public.accounts a
  JOIN auth.users u ON u.id = a.user_id
  WHERE a.family_squares_weekly_seat
    AND u.email_confirmed_at IS NOT NULL
    AND nullif(btrim(u.email::text), '') IS NOT NULL
    AND u.deleted_at IS NULL
    AND NOT coalesce(u.is_anonymous, false)
    AND coalesce(a.locale, 'en') NOT LIKE 'es%'
  ON CONFLICT (session_id, account_id) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public._family_squares_restore_weekly_seats(date) FROM PUBLIC, anon, authenticated;

-- Otherwise unchanged from 20261103130000_family_squares_reset_keeps_next_week_rsvps.
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

  -- Keep last night's RSVP counts for Admin before they are cleared. Counting
  -- must never stop the reset itself.
  BEGIN
    PERFORM public._family_squares_record_meeting_stats(v_local_now::date - 1);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'family squares meeting stats not recorded: %', SQLERRM;
  END;

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

  -- "Save my seat every Monday": next Monday's seat (six days from this
  -- Tuesday). A failure here must never undo the reset above.
  BEGIN
    PERFORM public._family_squares_restore_weekly_seats(v_local_now::date + 6);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'family squares weekly seats not saved: %', SQLERRM;
  END;

  -- The number of rows cleared, as before.
  RETURN v_deleted + v_more + v_links;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reset_family_squares_weekly_rsvps() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_family_squares_weekly_rsvps() TO service_role;
