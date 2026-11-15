BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Who gets which Tuesday note after Family Squares (20261114140000). The
-- wording for members without a weekly seat is also checked, with older
-- builds, in monday_call_followup_test.
-- Builds: no contract = before 4.2 (3), 1 = 4.2 (3)+, 2 = 4.3+.

-- ── Fixtures: Monday 2025-12-08's meeting (7 PM Pacific) ────────────────────
DELETE FROM public.session_rsvps;
DELETE FROM public.family_squares_meeting_status;
INSERT INTO auth.users(id, email, raw_app_meta_data, raw_user_meta_data, aud, role, email_confirmed_at) VALUES
  ('1c000000-0000-0000-0000-000000000001', 'mf-a@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-000000000002', 'mf-b@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-000000000003', 'mf-c@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-000000000004', 'mf-d@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-000000000005', 'mf-e@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-000000000006', 'mf-f@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-000000000007', 'mf-g@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-000000000008', 'mf-h@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-000000000009', 'mf-i@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-00000000000a', 'mf-j@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-00000000000b', 'mf-k@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-00000000000c', 'mf-l@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-00000000000d', 'mf-m@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-00000000000e', 'mf-n@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-00000000000f', 'mf-o@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-000000000000', 'mf-q@example.com', '{}', '{}', 'authenticated', 'authenticated', now())
ON CONFLICT (id) DO NOTHING;
UPDATE public.accounts SET id = ('2c000000-0000-0000-0000-00000000000' || right(user_id::text, 1))::uuid
WHERE user_id::text LIKE '1c000000-0000-0000-0000-00000000000_';
-- Everyone: a device on a 4.3+ build (contract 2), Monday reminders on, English.
UPDATE public.accounts SET push_token = 'ExponentPushToken[mf-' || right(id::text, 1) || ']',
  family_call_reminders = true, locale = 'en', timezone = 'America/New_York', push_app_contract = 2
WHERE id::text LIKE '2c000000-0000-0000-0000-00000000000_';
-- "Save my seat every Monday" is on for B, F, G, I and O. G is on an older build.
UPDATE public.accounts SET family_squares_weekly_seat = true
WHERE id IN ('2c000000-0000-0000-0000-000000000002', '2c000000-0000-0000-0000-000000000006',
  '2c000000-0000-0000-0000-000000000007', '2c000000-0000-0000-0000-000000000009',
  '2c000000-0000-0000-0000-00000000000f');
UPDATE public.accounts SET push_app_contract = NULL WHERE id = '2c000000-0000-0000-0000-000000000007';
-- Q, J and M are on 4.2 (contract 1): its Join tap can be lost, so it never
-- gets the "we missed you" wording.
UPDATE public.accounts SET push_app_contract = 1
WHERE id IN ('2c000000-0000-0000-0000-000000000000', '2c000000-0000-0000-0000-00000000000a',
  '2c000000-0000-0000-0000-00000000000d');
-- J, K, L, M, N and O each lost their loved one. K and N also paused
-- reminders while they grieve. L is a paying member.
INSERT INTO public.loved_ones(account_id, died_at, bereavement_quiet) VALUES
  ('2c000000-0000-0000-0000-00000000000a', now(), false),
  ('2c000000-0000-0000-0000-00000000000b', now(), true),
  ('2c000000-0000-0000-0000-00000000000c', now(), false),
  ('2c000000-0000-0000-0000-00000000000d', now(), false),
  ('2c000000-0000-0000-0000-00000000000e', now(), true),
  ('2c000000-0000-0000-0000-00000000000f', now(), false);
INSERT INTO public.entitlements(account_id, source, tier, expires_at)
VALUES ('2c000000-0000-0000-0000-00000000000c', 'web', 'essential', now() + interval '30 days');

INSERT INTO public.session_rsvps(account_id, session_id, status, family_squares_meeting_date, created_at) VALUES
  -- A saved her own seat and never tapped Join.
  ('2c000000-0000-0000-0000-000000000001', public.family_squares_session_id(), 'going', '2025-12-08', '2025-12-04 10:00 America/Los_Angeles'),
  -- B's seat was saved for her (weekly seat); no Join tap in the app.
  ('2c000000-0000-0000-0000-000000000002', public.family_squares_session_id(), 'going', '2025-12-08', '2025-12-02 02:05 America/Los_Angeles'),
  -- C saved a seat and opened the meeting early.
  ('2c000000-0000-0000-0000-000000000003', public.family_squares_session_id(), 'going', '2025-12-08', '2025-12-04 10:00 America/Los_Angeles'),
  -- D saved a seat; her only Join tap was in the afternoon, before 5 PM.
  ('2c000000-0000-0000-0000-000000000004', public.family_squares_session_id(), 'going', '2025-12-08', '2025-12-04 10:00 America/Los_Angeles'),
  -- E said she can't make it. So did F, who has a weekly seat.
  ('2c000000-0000-0000-0000-000000000005', public.family_squares_session_id(), 'declined', '2025-12-08', '2025-12-04 10:00 America/Los_Angeles'),
  ('2c000000-0000-0000-0000-000000000006', public.family_squares_session_id(), 'declined', '2025-12-08', '2025-12-02 02:05 America/Los_Angeles'),
  -- G: a weekly seat, on an older build.
  ('2c000000-0000-0000-0000-000000000007', public.family_squares_session_id(), 'going', '2025-12-08', '2025-12-02 02:05 America/Los_Angeles'),
  -- Q (4.2) saved her own seat; the app has no Join tap from her.
  ('2c000000-0000-0000-0000-000000000000', public.family_squares_session_id(), 'going', '2025-12-08', '2025-12-04 10:00 America/Los_Angeles'),
  -- J, K and L (bereaved) each saved a seat and never tapped Join.
  ('2c000000-0000-0000-0000-00000000000a', public.family_squares_session_id(), 'going', '2025-12-08', '2025-12-04 10:00 America/Los_Angeles'),
  ('2c000000-0000-0000-0000-00000000000b', public.family_squares_session_id(), 'going', '2025-12-08', '2025-12-04 10:00 America/Los_Angeles'),
  ('2c000000-0000-0000-0000-00000000000c', public.family_squares_session_id(), 'going', '2025-12-08', '2025-12-04 10:00 America/Los_Angeles'),
  -- M (bereaved) saved a seat and tapped Join.
  ('2c000000-0000-0000-0000-00000000000d', public.family_squares_session_id(), 'going', '2025-12-08', '2025-12-04 10:00 America/Los_Angeles'),
  -- O (bereaved): her weekly seat was saved for her; no Join tap.
  ('2c000000-0000-0000-0000-00000000000f', public.family_squares_session_id(), 'going', '2025-12-08', '2025-12-02 02:05 America/Los_Angeles');
  -- H has no seat. I has a weekly seat but no seat was saved for this meeting.
  -- N (bereaved, paused) has no seat and stayed ten minutes.
INSERT INTO public.funnel_events(account_id, stage, metadata, created_at) VALUES
  ('2c000000-0000-0000-0000-000000000003', 'attended', '{"source":"push"}', '2025-12-08 17:30 America/Los_Angeles'),
  ('2c000000-0000-0000-0000-000000000004', 'attended', '{"source":"today"}', '2025-12-08 16:59 America/Los_Angeles'),
  ('2c000000-0000-0000-0000-000000000008', 'attended', '{"source":"today"}', '2025-12-08 17:00 America/Los_Angeles'),
  ('2c000000-0000-0000-0000-00000000000d', 'attended', '{"source":"today"}', '2025-12-08 19:02 America/Los_Angeles'),
  ('2c000000-0000-0000-0000-00000000000e', 'attended_10min', '{"meeting_date":"2025-12-08","source":"push"}', '2025-12-08 19:15 America/Los_Angeles');

-- ── Tuesday 1 AM Pacific ────────────────────────────────────────────────────
SELECT is(public.enqueue_family_call_followups('2025-12-09 01:10 America/Los_Angeles'), 9, 'nine notes');
SELECT set_eq(
  $$SELECT right(account_id::text, 1) FROM push_outbox WHERE idempotency_key LIKE 'family-call-followup:2025-12-08:%'$$,
  $$VALUES ('0'), ('1'), ('2'), ('3'), ('4'), ('7'), ('8'), ('d'), ('e')$$,
  'a saved seat or a Join tap; not E or F, who said they can''t make it, nor I, who had no seat, nor a bereaved member the app did not see join');
SELECT is(public.enqueue_family_call_followups('2025-12-09 01:40 America/Los_Angeles'), 0, 'one note per member per meeting');

CREATE FUNCTION pg_temp.note(p_account text, p_meeting text DEFAULT '2025-12-08') RETURNS text LANGUAGE sql AS $$
  SELECT title || ' | ' || body FROM push_outbox
  WHERE idempotency_key = 'family-call-followup:' || p_meeting || ':2c000000-0000-0000-0000-00000000000' || p_account
$$;
-- A member whose loved one died is never told she was missed. If the app did
-- not see her join, nothing is queued for her at all.
SELECT is(pg_temp.note('a'), NULL, 'J is bereaved (4.2), saved a seat and did not tap Join: no note');
SELECT is(pg_temp.note('b'), NULL, 'K paused reminders while she grieves and did not tap Join: nothing is queued, so nothing waits for her to un-pause');
SELECT is(pg_temp.note('c'), NULL, 'L is bereaved and a paying member: no note either');
SELECT is(pg_temp.note('f'), NULL, 'O is bereaved with a weekly seat: a seat saved for her is not a sign that she came');
-- If she was there: one plain line.
SELECT is(pg_temp.note('d'),
  'After Monday''s call | It was good to have you at Family Squares on Monday. You are welcome any week.',
  'M is bereaved (4.2) and tapped Join: the plain note, under the title the attended note uses');
SELECT is(pg_temp.note('e'),
  'After Monday''s call | It was good to have you at Family Squares on Monday. You are welcome any week.',
  'N paused reminders and stayed ten minutes: the same line is queued (delivery holds it while she is paused)');
SELECT ok(NOT EXISTS (
    SELECT 1 FROM push_outbox o
    WHERE o.kind = 'family_call_followup' AND public._account_bereaved(o.account_id)
      AND o.body ~* 'missed|got away|one thing|today|seat|tap|member|recording|library'),
  'no note to a bereaved member says she was missed, points at a card she does not have, or mentions a seat, members or recordings');
SELECT is(pg_temp.note('1'),
  'Family Squares | If Monday got away from you, we missed you. Next Monday''s seat is one tap away, and members can watch recordings of past meetings.',
  'A (4.3) saved her own seat and never tapped Join: the "we missed you" note');
SELECT is(pg_temp.note('0'),
  'After Monday''s call | Your one thing to try this week is on Today, and next Monday''s seat is one tap away.',
  'Q (4.2) did the same: the note 4.2 always got, because 4.2 can lose a Join tap and she may have been there');
SELECT ok(NOT EXISTS (
    SELECT 1 FROM push_outbox o JOIN public.accounts a ON a.id = o.account_id
    WHERE o.kind = 'family_call_followup' AND coalesce(a.push_app_contract, 0) < 2 AND (o.body ~* 'missed|got away' OR o.title = 'Family Squares')),
  'no build below contract 2 is ever told "we missed you"');
SELECT is(pg_temp.note('2'),
  'After Monday''s call | Your one thing to try this week is on Today, and your weekly seat is on for next Monday.',
  'B has a weekly seat and no Join tap in the app: never "we missed you", and nothing about tapping to save a seat');
SELECT ok(NOT EXISTS (
    SELECT 1 FROM push_outbox o WHERE o.kind = 'family_call_followup' AND o.body ~* 'is saved|saved automatically|will be saved'),
  'no note promises a saved seat: the sync saves it only once the website agrees, and not for every member');
SELECT is(pg_temp.note('3'),
  'After Monday''s call | Your one thing to try this week is on Today, and next Monday''s seat is one tap away.',
  'C tapped Join at 5:30 PM Pacific: an early Join counts as joined');
SELECT is(pg_temp.note('8'),
  'After Monday''s call | Your one thing to try this week is on Today, and next Monday''s seat is one tap away.',
  'H tapped Join at 5:00 PM without a seat: she joined too');
SELECT is(pg_temp.note('4'),
  'Family Squares | If Monday got away from you, we missed you. Next Monday''s seat is one tap away, and members can watch recordings of past meetings.',
  'D''s only tap was at 4:59 PM: not this meeting');
SELECT is(pg_temp.note('7'),
  'After Monday''s call | Next Monday''s call is free too. You can save your seat in the app.',
  'G is on an older build: the wording it always had, weekly seat or not');
SELECT is(pg_temp.note('5'), NULL, 'E said she can''t make it and did not join: no note');
SELECT is(pg_temp.note('6'), NULL, 'F declined too; her weekly seat does not bring a note back');
SELECT ok(NOT EXISTS (
    SELECT 1 FROM push_outbox o JOIN public.accounts a ON a.id = o.account_id
    WHERE o.kind = 'family_call_followup' AND a.family_squares_weekly_seat AND o.body ~* 'missed you|one tap away'),
  'no member with a weekly seat is told she was missed, or to tap for a seat she already has');

-- ── The next meeting, with Matt's line written ──────────────────────────────
INSERT INTO public.family_call_takeaways(meeting_date, body) VALUES ('2025-12-15', 'Rest is part of the work.')
ON CONFLICT (meeting_date) DO UPDATE SET body = EXCLUDED.body;
-- B and F have their seats again. So do four more:
--   A (4.3) and Q (4.2), who again show no sign of joining;
--   M (bereaved), who stays ten minutes this time;
--   J (bereaved), now on an older build, who does not tap Join.
UPDATE public.accounts SET push_app_contract = NULL WHERE id = '2c000000-0000-0000-0000-00000000000a';
UPDATE public.session_rsvps SET family_squares_meeting_date = '2025-12-15', status = 'going'
WHERE session_id = public.family_squares_session_id()
  AND account_id IN ('2c000000-0000-0000-0000-000000000002', '2c000000-0000-0000-0000-000000000006',
    '2c000000-0000-0000-0000-000000000001', '2c000000-0000-0000-0000-000000000000',
    '2c000000-0000-0000-0000-00000000000d', '2c000000-0000-0000-0000-00000000000a');
-- F stayed ten minutes this time; B again shows no sign of joining in the app.
INSERT INTO public.funnel_events(account_id, stage, metadata, created_at) VALUES
  ('2c000000-0000-0000-0000-000000000006', 'attended_10min', '{"meeting_date":"2025-12-15","source":"push"}', '2025-12-15 20:10 America/Los_Angeles'),
  ('2c000000-0000-0000-0000-00000000000d', 'attended_10min', '{"meeting_date":"2025-12-15","source":"today"}', '2025-12-15 19:20 America/Los_Angeles');
SELECT is(public.enqueue_family_call_followups('2025-12-16 01:10 America/Los_Angeles'), 6, 'the week after: A, B, F, J, M and Q');
SELECT is(ARRAY(SELECT right(account_id::text, 1) || ': ' || body FROM push_outbox
    WHERE idempotency_key LIKE 'family-call-followup:2025-12-15:%'
      AND account_id IN ('2c000000-0000-0000-0000-000000000002', '2c000000-0000-0000-0000-000000000006') ORDER BY 1),
  ARRAY['2: This week''s one thing: Rest is part of the work.', '6: This week''s one thing: Rest is part of the work.'],
  'weekly-seat members get Matt''s line like everyone who came, week after week, whether or not the app saw them join');
SELECT is(pg_temp.note('1', '2025-12-15'),
  'Family Squares | If Monday got away from you, we missed you. Next Monday''s seat is one tap away, and members can watch recordings of past meetings.',
  'A (4.3): her note does not become the one thing from a meeting she may have missed');
SELECT is(pg_temp.note('0', '2025-12-15'),
  'After Monday''s call | This week''s one thing: Rest is part of the work.',
  'Q (4.2): Matt''s line, as 4.2 always got; never "we missed you"');
SELECT is(pg_temp.note('d', '2025-12-15'),
  'After Monday''s call | It was good to have you at Family Squares on Monday. You are welcome any week.',
  'M is bereaved and was there: the plain line, not "this week''s one thing" (her Today has no such card)');
SELECT is(pg_temp.note('a', '2025-12-15'),
  'After Monday''s call | This week''s one thing: Rest is part of the work.',
  'J is on an older build now: the wording older builds always had, and never "missed"');
-- These four are done: their seats are cleared so the weeks below are as before.
DELETE FROM public.session_rsvps WHERE account_id IN ('2c000000-0000-0000-0000-000000000001',
  '2c000000-0000-0000-0000-000000000000', '2c000000-0000-0000-0000-00000000000d', '2c000000-0000-0000-0000-00000000000a');

-- ── A Monday the website cancelled: no Tuesday note at all ──────────────────
-- 2025-12-22: B and F still have their seats (saved before the cancellation),
-- and H tapped Join anyway.
UPDATE public.session_rsvps SET family_squares_meeting_date = '2025-12-22'
WHERE session_id = public.family_squares_session_id()
  AND account_id IN ('2c000000-0000-0000-0000-000000000002', '2c000000-0000-0000-0000-000000000006');
INSERT INTO public.funnel_events(account_id, stage, metadata, created_at)
VALUES ('2c000000-0000-0000-0000-000000000008', 'attended', '{"source":"today"}', '2025-12-22 18:55 America/Los_Angeles');
-- A cancellation recorded for a DIFFERENT Monday says nothing about last
-- night: next Monday (2025-12-29, the date the sync has been writing since
-- 8 PM) and the Monday before (2025-12-15) are both cancelled, and last
-- night's meeting is on.
INSERT INTO public.family_squares_meeting_status(meeting_date, cancelled, noted_at) VALUES
  ('2025-12-29', true, now()),
  ('2025-12-15', true, '2025-12-15 19:45 America/Los_Angeles'),
  ('2025-12-22', false, '2025-12-22 19:45 America/Los_Angeles');
SELECT is(public.family_squares_meeting_cancelled('2025-12-22'), false, 'last night''s meeting was on');
SELECT ok(public.family_squares_meeting_cancelled('2025-12-29') AND public.family_squares_meeting_cancelled('2025-12-15'),
  '(the Mondays either side of it really are recorded as cancelled)');
-- Nothing is written here: the function is only asked what it would do, in
-- a block that is rolled back, so the cancelled case below starts clean.
CREATE FUNCTION pg_temp.would_enqueue(p_at timestamptz) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_count integer;
BEGIN
  BEGIN
    v_count := public.enqueue_family_call_followups(p_at);
    RAISE EXCEPTION 'undo' USING ERRCODE = 'P0001';
  EXCEPTION WHEN raise_exception THEN
    NULL;
  END;
  RETURN v_count;
END;
$$;
SELECT is(pg_temp.would_enqueue('2025-12-23 01:10 America/Los_Angeles'), 3,
  'a cancellation for next Monday, or for the Monday before, does not stop the note for the meeting that happened');
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE idempotency_key LIKE 'family-call-followup:2025-12-22:%'), 0,
  '(that was only asked, not written)');

-- Last night's meeting itself was cancelled. The last sync before it ended
-- wrote that at 7:45 PM, more than five hours before the 1 AM job: it stands.
UPDATE public.family_squares_meeting_status SET cancelled = true WHERE meeting_date = '2025-12-22';
SELECT is(public.family_squares_meeting_cancelled('2025-12-22'), true, 'a cancellation written before the meeting ended still stands on Tuesday');
SELECT is(public.enqueue_family_call_followups('2025-12-23 01:10 America/Los_Angeles'), 0, 'a cancelled meeting is not followed up');
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE idempotency_key LIKE 'family-call-followup:2025-12-22:%'), 0,
  'nobody is told "we missed you" or handed a takeaway for a meeting that did not happen');
-- Only last night's row decides: with the other two Mondays put back on, it
-- is still cancelled.
UPDATE public.family_squares_meeting_status SET cancelled = false WHERE meeting_date IN ('2025-12-29', '2025-12-15');
SELECT is(public.enqueue_family_call_followups('2025-12-23 01:15 America/Los_Angeles'), 0, 'whatever the other Mondays say');
-- A "cancelled" written before the meeting day and never repeated (the sync
-- had stopped) is not believed: the notes go out.
UPDATE public.family_squares_meeting_status SET noted_at = '2025-12-21 23:00 America/Los_Angeles' WHERE meeting_date = '2025-12-22';
SELECT is(pg_temp.would_enqueue('2025-12-23 01:10 America/Los_Angeles'), 3,
  'a cancellation last heard the day before the meeting does not silence the note');
UPDATE public.family_squares_meeting_status SET noted_at = '2025-12-22 19:45 America/Los_Angeles' WHERE meeting_date = '2025-12-22';
SELECT is(pg_temp.would_enqueue('2025-12-23 01:10 America/Los_Angeles'), 0, 'heard again on the day: silent again');

-- The website's answer changes before the job runs again: the notes go out,
-- although next Monday and the Monday before are cancelled once more.
UPDATE public.family_squares_meeting_status SET cancelled = (meeting_date <> '2025-12-22');
SELECT is(public.enqueue_family_call_followups('2025-12-23 01:20 America/Los_Angeles'), 3, 'a meeting that was on is followed up as before');
SELECT is(ARRAY(SELECT right(account_id::text, 1) || ': ' || body FROM push_outbox
    WHERE idempotency_key LIKE 'family-call-followup:2025-12-22:%' ORDER BY 1),
  ARRAY['2: Your one thing to try this week is on Today, and your weekly seat is on for next Monday.',
    '6: Your one thing to try this week is on Today, and your weekly seat is on for next Monday.',
    '8: Your one thing to try this week is on Today, and next Monday''s seat is one tap away.'],
  'weekly-seat members are told their weekly seat is on; everyone else that a seat is one tap away');
SELECT is(public.enqueue_family_call_followups('2025-12-23 01:30 America/Los_Angeles'), 0, 'one note per member per meeting, as before');

SELECT * FROM finish();
ROLLBACK;
