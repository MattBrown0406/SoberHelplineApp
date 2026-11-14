-- Family Squares: "Save my seat every Monday" and "Can't make it this week".
--
-- RSVPs are cleared every Tuesday at 2 AM Pacific, so a member who comes every
-- week had to save her seat again every week, and nobody could take an RSVP
-- back.
--
-- 1. accounts.family_squares_weekly_seat (off by default). She turns it on or
--    off herself with set_family_squares_weekly_seat().
-- 2. decline_family_squares_rsvp(): her "going" becomes "declined" for this
--    week's meeting. What a declined RSVP stops:
--      * the hour-before and 15-minute reminders (they need "going");
--      * the 6:30 PM invite (it skips "going" and "declined");
--      * Monday morning's "Family Squares tonight" note: the
--        notify-daily-morning Edge Function reads her RSVP and sends her
--        ordinary morning note instead;
--      * Tuesday's follow-up note, unless she joined after all
--        (20261114140000).
--    The website already hears "declined". Saving her spot again
--    (family-squares-register) turns it back to "going".
-- 3. The weekly seat is saved by the Edge layer, never here in SQL: the
--    website decides whether a seat can be saved (a cancelled Monday, a
--    blocked attendee), and SQL cannot ask it. Every 15 minutes
--    family-squares-web-sync asks the website for each member returned by
--    service_family_squares_weekly_seat_candidates() and, only when the
--    website accepts, writes the row with
--    service_family_squares_save_weekly_seat(). The row looks exactly like
--    one family-squares-register writes (going, dated, created now), so the
--    reminders and the website sync treat it like any RSVP. A decline is
--    cleared with the rest on Tuesday, so it lasts one week only.
-- 4. The weekly reset is unchanged except that it first records the finished
--    meeting's RSVP counts (20261114110000).

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS family_squares_weekly_seat boolean NOT NULL DEFAULT false;
-- When she last turned it on. Asking for a weekly seat is itself a sign that
-- she uses the app (see the candidates function below).
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS family_squares_weekly_seat_set_at timestamptz;

-- She reads her own preference (the accounts RLS policy limits rows to her
-- own). Members can already read every accounts column today; this keeps the
-- preference readable if that is ever narrowed to named columns.
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
  UPDATE public.accounts
  SET family_squares_weekly_seat = p_enabled,
      family_squares_weekly_seat_set_at = CASE WHEN p_enabled THEN now() ELSE family_squares_weekly_seat_set_at END
  WHERE id = public.my_account_id();
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

-- ── The weekly seat: saved by family-squares-web-sync, after the website agrees ──

-- The Monday (Pacific date) of the next Family Squares meeting that has not
-- ended: tonight's until 8 PM Pacific, then next Monday's. The same meeting
-- familySquaresSyncWindow() names in the Edge Functions.
CREATE OR REPLACE FUNCTION public._family_squares_coming_meeting_date(p_now timestamptz DEFAULT now())
RETURNS date
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_now < (l.latest + time '20:00') AT TIME ZONE 'America/Los_Angeles' THEN l.latest
    ELSE l.latest + 7
  END
  FROM (SELECT public._family_squares_latest_meeting_date(p_now) AS latest) l;
$$;
REVOKE ALL ON FUNCTION public._family_squares_coming_meeting_date(timestamptz) FROM PUBLIC, anon, authenticated;

-- What the website answered when it would not save a weekly seat, so it is
-- not asked the same question every 15 minutes:
--   registration_unavailable  the website will not register her; she is not
--                             asked about again for that meeting.
--   meeting_cancelled         that Monday is cancelled; nobody is asked about
--                             for the next six hours (it may be put back on).
-- Account ids and dates only. Rows for meetings more than four weeks old are
-- removed whenever a new one is written.
CREATE TABLE IF NOT EXISTS public.family_squares_weekly_seat_holds (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  meeting_date date NOT NULL,
  reason text NOT NULL CHECK (reason IN ('meeting_cancelled', 'registration_unavailable')),
  noted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, meeting_date)
);
ALTER TABLE public.family_squares_weekly_seat_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.family_squares_weekly_seat_holds FROM PUBLIC, anon, authenticated;

-- Who family-squares-web-sync should ask the website about for the coming
-- meeting: members who asked for a seat every Monday and have no RSVP for
-- Family Squares at all. A member who answered (going or declined) keeps her
-- answer; and until the Tuesday reset has cleared last night's RSVPs nobody
-- is returned, so last night's rows are still there for the Tuesday note and
-- the recorded counts.
--   * The same people family-squares-register accepts: a verified email on a
--     real (not anonymous, not deleted) sign-in.
--   * Not Spanish members: they are invited to La Sobremesa.
--   * Not a member who paused reminders while she grieves.
--   * Only members who used the app in the last 35 days, so a seat is not
--     saved for ever for someone who has left. Any of: her device checked in
--     (push_token_seen_at, every launch with notifications on), she signed in,
--     she turned the weekly seat on, or the app logged something she did
--     (funnel_events: a Join tap, a tool opened).
-- At most ten a run, in no fixed order, so one account the website cannot
-- answer for never holds up the rest.
CREATE OR REPLACE FUNCTION public.service_family_squares_weekly_seat_candidates(p_meeting_date date)
RETURNS TABLE(account_id uuid, email text, name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session uuid := public.family_squares_session_id();
BEGIN
  -- Only ever the coming meeting: a late or early caller gets nobody.
  IF v_session IS NULL OR p_meeting_date IS DISTINCT FROM public._family_squares_coming_meeting_date(now()) THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.family_squares_weekly_seat_holds h
    WHERE h.meeting_date = p_meeting_date AND h.reason = 'meeting_cancelled'
      AND h.noted_at > now() - interval '6 hours'
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT a.id,
         lower(btrim(u.email::text)),
         -- The name family-squares-register sends.
         left(coalesce(nullif(btrim(concat_ws(' ', nullif(btrim(a.first_name), ''), nullif(btrim(a.last_name), ''))), ''), 'Family'), 100)
  FROM public.accounts a
  JOIN auth.users u ON u.id = a.user_id
  WHERE a.family_squares_weekly_seat
    AND u.email_confirmed_at IS NOT NULL
    AND nullif(btrim(u.email::text), '') IS NOT NULL
    AND u.deleted_at IS NULL
    AND NOT coalesce(u.is_anonymous, false)
    AND coalesce(a.locale, 'en') NOT LIKE 'es%'
    AND NOT public._account_reminders_paused(a.id)
    -- greatest() ignores the signals she does not have; with none it is NULL.
    AND greatest(
          a.push_token_seen_at,
          u.last_sign_in_at,
          a.family_squares_weekly_seat_set_at,
          (SELECT max(e.created_at) FROM public.funnel_events e WHERE e.account_id = a.id)
        ) > now() - interval '35 days'
    AND NOT EXISTS (
      SELECT 1 FROM public.session_rsvps r
      WHERE r.session_id = v_session AND r.account_id = a.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.family_squares_weekly_seat_holds h
      WHERE h.account_id = a.id AND h.meeting_date = p_meeting_date
        AND h.reason = 'registration_unavailable'
    )
  ORDER BY random()
  LIMIT 10;
END;
$$;
REVOKE ALL ON FUNCTION public.service_family_squares_weekly_seat_candidates(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_family_squares_weekly_seat_candidates(date) TO service_role;

-- Called only after the website accepted her registration. True when a seat
-- was written. It never replaces a row: an answer she gave in the meantime
-- (going or declined) stands, and so does turning the weekly seat off.
CREATE OR REPLACE FUNCTION public.service_family_squares_save_weekly_seat(p_account_id uuid, p_meeting_date date)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session uuid := public.family_squares_session_id();
  v_saved boolean;
BEGIN
  IF v_session IS NULL OR p_account_id IS NULL
     OR p_meeting_date IS DISTINCT FROM public._family_squares_coming_meeting_date(now()) THEN
    RETURN false;
  END IF;
  INSERT INTO public.session_rsvps (session_id, account_id, status, family_squares_meeting_date, created_at)
  SELECT v_session, a.id, 'going', p_meeting_date, now()
  FROM public.accounts a
  WHERE a.id = p_account_id AND a.family_squares_weekly_seat
  ON CONFLICT (session_id, account_id) DO NOTHING;
  v_saved := FOUND;
  -- The website said yes: whatever it said before no longer holds.
  DELETE FROM public.family_squares_weekly_seat_holds h
  WHERE h.account_id = p_account_id AND h.meeting_date = p_meeting_date;
  RETURN v_saved;
END;
$$;
REVOKE ALL ON FUNCTION public.service_family_squares_save_weekly_seat(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_family_squares_save_weekly_seat(uuid, date) TO service_role;

-- Called when the website would not save her seat (see the table above).
CREATE OR REPLACE FUNCTION public.service_family_squares_hold_weekly_seat(
  p_account_id uuid, p_meeting_date date, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_account_id IS NULL OR p_meeting_date IS NULL
     OR p_reason IS NULL OR p_reason NOT IN ('meeting_cancelled', 'registration_unavailable') THEN
    RAISE EXCEPTION 'invalid_hold' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.family_squares_weekly_seat_holds h WHERE h.meeting_date < p_meeting_date - 28;
  INSERT INTO public.family_squares_weekly_seat_holds (account_id, meeting_date, reason, noted_at)
  VALUES (p_account_id, p_meeting_date, p_reason, now())
  ON CONFLICT (account_id, meeting_date) DO UPDATE
    SET reason = EXCLUDED.reason, noted_at = EXCLUDED.noted_at;
END;
$$;
REVOKE ALL ON FUNCTION public.service_family_squares_hold_weekly_seat(uuid, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_family_squares_hold_weekly_seat(uuid, date, text) TO service_role;

-- The weekly reset. It records last night's counts first; otherwise unchanged
-- from 20261103130000_family_squares_reset_keeps_next_week_rsvps.
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
  -- Weekly seats are not saved here: family-squares-web-sync saves them after
  -- the website agrees (see above).
  RETURN v_deleted + v_more + v_links;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.reset_family_squares_weekly_rsvps() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_family_squares_weekly_rsvps() TO service_role;
