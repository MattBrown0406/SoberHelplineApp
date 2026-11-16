-- A kinder Tuesday note for members who saved a seat and did not come.
--
-- The Tuesday follow-up (20261104100000_monday_call_followup) sends one note
-- to everyone who saved a seat for Monday's Family Squares or tapped Join
-- during it. Someone who saved a seat and never tapped Join was getting the
-- note written for people who were there.
--
-- Which build registers which push_app_contract:
--   none  builds before 4.2 (3).
--   1     4.2 (3)+. It logs a Join tap after Zoom has opened, where the tap
--         can be lost, so a missing tap does not show she was not there.
--   2     4.3+. It logs the Join tap before Zoom opens.
--
-- Now:
--   * saved a seat herself ('going' for that meeting) and no sign in the app
--     that she joined, on a build that registers 2 or more: "If Monday got
--     away from you, we missed you. Next Monday's seat is one tap away, and
--     ..." followed by where recordings of past meetings are (her library for
--     a member; "members can watch" for anyone else). On a build that
--     registers 1 she gets the note she always got: it must never tell a
--     member who was there that she was missed.
--   * joined (with or without a seat): the note she always got.
--   * has "Save my seat every Monday" on (builds that register 1 or more):
--     always the note she always got, never "we missed you". Her seat is
--     saved for her, and she may join from her calendar, an email link or
--     another device, none of which the app can see, so a missing Join tap
--     says nothing about her. Her note ends with her weekly seat being on
--     instead of "one tap away". It does not say that next Monday's seat is
--     saved: the 15-minute job saves it only once the website agrees, and
--     skips a few members (an unverified email, no sign of app use in 180
--     days), so that would not be true for everyone.
--   * her loved one has died (_account_bereaved, whether or not she paused
--     reminders), on a build that registers 1 or more: a note only if the app
--     saw her join, and then one plain line: "It was good to have you at
--     Family Squares on Monday. You are welcome any week." Her Today has no
--     "one thing" card, so the note does not point at one, and it says
--     nothing about a seat, members or recordings. If the app did not see her
--     join, no note is queued at all, saved seat or weekly seat: grief is no
--     time to be told she was missed.
-- Older builds (no contract) keep the wording they already had, whoever they
-- are.
--
-- A cancelled Monday (family_squares_meeting_cancelled, 20261114120000) gets
-- no Tuesday note at all: there was no meeting to follow up on or to miss.
-- By 1 AM on Tuesday the sync has been writing next Monday's status for five
-- hours, so for a meeting that has ended the website's last answer stands as
-- long as it was written on the day of the meeting or later. A cancellation
-- recorded for any other Monday changes nothing here.
--
-- "Joined" means a Join tap in the app from 5 PM Pacific on the meeting day
-- (people open the meeting early) until half an hour after it ends, or the
-- app's "stayed ten minutes" mark for that meeting.
--
-- How it knows who saved a seat: exactly as before. This runs at 1 AM Pacific
-- on Tuesday, an hour before the 2 AM reset clears Monday's RSVPs, and reads
-- session_rsvps directly (a dated 'going' row for that Monday, or a 4.1
-- undated row saved during the week before it). A "can't make it" answer is
-- status 'declined', not 'going': she told us, and gets no note unless she
-- joined after all.
--
-- Everything else is unchanged: who is eligible (a device, Monday reminders
-- on, not Spanish), the 10:30 AM local time, the 9 PM cut-off, one note per
-- member per meeting, the routed payload, and every delivery rule in
-- dispatcher_outbox_delivery (her daytime, the reminder switch, the
-- bereavement pause).

CREATE OR REPLACE FUNCTION public.enqueue_family_call_followups(p_now timestamptz DEFAULT clock_timestamp())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local timestamp := p_now AT TIME ZONE 'America/Los_Angeles';
  v_session uuid := public.family_squares_session_id();
  v_meeting date;
  v_join_from timestamptz;
  v_end timestamptz;
  v_prev_end timestamptz;
  v_takeaway text;
  v_count integer := 0;
BEGIN
  -- pg_cron runs in UTC at both possible offsets; only the 1 AM Pacific
  -- Tuesday run enqueues.
  IF extract(isodow FROM v_local) <> 2 OR extract(hour FROM v_local) <> 1 OR v_session IS NULL THEN
    RETURN 0;
  END IF;
  v_meeting := v_local::date - 1;
  -- The website cancelled last night's meeting: nobody was there and nobody
  -- missed it. (If that cannot be read the answer is "not cancelled", and the
  -- notes go out as before.) Only an answer about that Monday, written on
  -- the day of the meeting or later, counts.
  IF public.family_squares_meeting_cancelled(v_meeting) THEN
    RETURN 0;
  END IF;
  -- The meeting starts at 7 PM; a Join tap counts from 5 PM.
  v_join_from := (v_meeting + time '17:00') AT TIME ZONE 'America/Los_Angeles';
  v_end := (v_meeting + time '20:00') AT TIME ZONE 'America/Los_Angeles';
  v_prev_end := ((v_meeting - 7) + time '20:00') AT TIME ZONE 'America/Los_Angeles';

  SELECT t.body INTO v_takeaway FROM public.family_call_takeaways t WHERE t.meeting_date = v_meeting;

  WITH candidates AS (
    SELECT a.id, a.push_app_contract,
      coalesce(a.family_squares_weekly_seat, false) AS weekly_seat,
      CASE WHEN nullif(btrim(coalesce(a.timezone, '')), '') IS NULL THEN 'America/Los_Angeles'
        ELSE public._invitation_valid_tz(a.timezone) END AS tz,
      EXISTS (
        SELECT 1 FROM public.session_rsvps r
        WHERE r.account_id = a.id AND r.session_id = v_session AND r.status = 'going'
          AND (r.family_squares_meeting_date = v_meeting
            -- 4.1 writes no occurrence: an undated seat saved during the
            -- week before the call was for this call.
            OR (r.family_squares_meeting_date IS NULL AND r.created_at > v_prev_end AND r.created_at < v_end))
      ) AS had_seat,
      (
        EXISTS (
          SELECT 1 FROM public.funnel_events e
          WHERE e.account_id = a.id AND e.stage = 'attended'
            AND e.created_at >= v_join_from AND e.created_at < v_end + interval '30 minutes'
        )
        -- Stayed ten minutes: she was there, whenever the Join tap was logged.
        OR EXISTS (
          SELECT 1 FROM public.funnel_events e
          WHERE e.account_id = a.id AND e.stage = 'attended_10min'
            AND e.metadata ->> 'meeting_date' = v_meeting::text
        )
      ) AS joined
    FROM public.accounts a
    WHERE nullif(a.push_token, '') IS NOT NULL
      AND coalesce(a.family_call_reminders, false)
      -- Spanish members are invited to La Sobremesa, not The Family Squares.
      AND coalesce(a.locale, 'en') NOT LIKE 'es%'
  ), targets AS (
    SELECT c.id, c.push_app_contract, c.tz, c.weekly_seat, c.joined,
      -- Saved a seat herself and never tapped Join in the app. Never a member
      -- whose seat is saved for her every Monday: see the top of this file.
      (c.had_seat AND NOT c.joined AND NOT c.weekly_seat) AS missed,
      -- Her loved one has died, and her build shows the bereaved Today.
      (coalesce(c.push_app_contract, 0) >= 1 AND public._account_bereaved(c.id)) AS bereaved
    FROM candidates c
    WHERE c.had_seat OR c.joined
  ), scheduled AS (
    SELECT t.id, t.tz, t.push_app_contract, t.missed, t.weekly_seat, t.bereaved,
      CASE
        WHEN (p_now AT TIME ZONE t.tz)::time < time '10:30'
          THEN ((p_now AT TIME ZONE t.tz)::date + time '10:30') AT TIME ZONE t.tz
        WHEN (p_now AT TIME ZONE t.tz)::time < time '20:00' THEN p_now
        ELSE (((p_now AT TIME ZONE t.tz)::date + 1) + time '10:30') AT TIME ZONE t.tz
      END AS due
    FROM targets t
    -- A bereaved member gets a note only if the app saw her join. A saved
    -- seat or a weekly seat alone queues nothing for her.
    WHERE t.joined OR NOT t.bereaved
  )
  INSERT INTO public.push_outbox (account_id, kind, title, body, metadata, idempotency_key, scheduled_for, expires_at)
  SELECT s.id, 'family_call_followup',
    CASE WHEN s.missed AND coalesce(s.push_app_contract, 0) >= 2 THEN 'Family Squares'
      ELSE 'After Monday''s call' END,
    CASE
      -- Her loved one has died and she was there (only joined members reach
      -- this line). Her Today has no "one thing" card, so Matt's line and the
      -- card are left out, and nothing is said about a seat, members or
      -- recordings.
      WHEN s.bereaved THEN
        'It was good to have you at Family Squares on Monday. You are welcome any week.'
      -- She saved a seat and did not tap Join. The app cannot see a join made
      -- from her calendar or an email, so the note does not say she was absent.
      -- Recordings are a member page: a member is told where hers are, anyone
      -- else that members can watch them. Nothing here says that this week's
      -- recording is posted yet.
      -- Only builds that register 2 or more (4.3+): they log the Join tap
      -- before Zoom opens. 4.2 logs it after, where it can be lost, so its
      -- members fall through to the note they always got.
      WHEN s.missed AND coalesce(s.push_app_contract, 0) >= 2 THEN
        'If Monday got away from you, we missed you. Next Monday''s seat is one tap away, and '
        || CASE WHEN public._dispatcher_member_access(s.id)
          THEN 'recordings of past meetings are in your library, under Tools.'
          ELSE 'members can watch recordings of past meetings.' END
      -- Her weekly seat is on, so there is nothing to tap. Only what is true
      -- for everyone with the switch on is said: not that the seat is saved.
      -- (With Matt's line written she gets that line, like everyone who came.)
      WHEN s.weekly_seat AND v_takeaway IS NULL AND coalesce(s.push_app_contract, 0) >= 1 THEN
        'Your one thing to try this week is on Today, and your weekly seat is on for next Monday.'
      -- Self-contained on any build.
      WHEN v_takeaway IS NOT NULL THEN 'This week''s one thing: ' || v_takeaway
      WHEN coalesce(s.push_app_contract, 0) >= 1 THEN
        'Your one thing to try this week is on Today, and next Monday''s seat is one tap away.'
      -- Older builds have no such card on Today.
      ELSE 'Next Monday''s call is free too. You can save your seat in the app.'
    END,
    jsonb_build_object('kind', 'family_call_followup', 'meeting_date', v_meeting::text),
    'family-call-followup:' || v_meeting || ':' || s.id,
    s.due,
    (((s.due AT TIME ZONE s.tz)::date) + time '21:00') AT TIME ZONE s.tz
  FROM scheduled s
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enqueue_family_call_followups(timestamptz) FROM PUBLIC, anon, authenticated;
