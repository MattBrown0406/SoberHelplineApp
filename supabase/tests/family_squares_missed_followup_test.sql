BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Who gets which Tuesday note after Family Squares (20261114140000). The
-- wording for members without a weekly seat is also checked, with older
-- builds, in monday_call_followup_test.

-- ── Fixtures: Monday 2025-12-08's meeting (7 PM Pacific) ────────────────────
DELETE FROM public.session_rsvps;
INSERT INTO auth.users(id, email, raw_app_meta_data, raw_user_meta_data, aud, role, email_confirmed_at) VALUES
  ('1c000000-0000-0000-0000-000000000001', 'mf-a@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-000000000002', 'mf-b@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-000000000003', 'mf-c@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-000000000004', 'mf-d@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-000000000005', 'mf-e@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-000000000006', 'mf-f@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-000000000007', 'mf-g@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-000000000008', 'mf-h@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('1c000000-0000-0000-0000-000000000009', 'mf-i@example.com', '{}', '{}', 'authenticated', 'authenticated', now())
ON CONFLICT (id) DO NOTHING;
UPDATE public.accounts SET id = ('2c000000-0000-0000-0000-00000000000' || right(user_id::text, 1))::uuid
WHERE user_id::text LIKE '1c000000-0000-0000-0000-00000000000_';
-- Everyone: a device on a 4.2 (3)+ build, Monday reminders on, English.
UPDATE public.accounts SET push_token = 'ExponentPushToken[mf-' || right(id::text, 1) || ']',
  family_call_reminders = true, locale = 'en', timezone = 'America/New_York', push_app_contract = 1
WHERE id::text LIKE '2c000000-0000-0000-0000-00000000000_';
-- "Save my seat every Monday" is on for B, F, G and I. G is on an older build.
UPDATE public.accounts SET family_squares_weekly_seat = true
WHERE id IN ('2c000000-0000-0000-0000-000000000002', '2c000000-0000-0000-0000-000000000006',
  '2c000000-0000-0000-0000-000000000007', '2c000000-0000-0000-0000-000000000009');
UPDATE public.accounts SET push_app_contract = NULL WHERE id = '2c000000-0000-0000-0000-000000000007';

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
  ('2c000000-0000-0000-0000-000000000007', public.family_squares_session_id(), 'going', '2025-12-08', '2025-12-02 02:05 America/Los_Angeles');
  -- H has no seat. I has a weekly seat but no seat was saved for this meeting.
INSERT INTO public.funnel_events(account_id, stage, metadata, created_at) VALUES
  ('2c000000-0000-0000-0000-000000000003', 'attended', '{"source":"push"}', '2025-12-08 17:30 America/Los_Angeles'),
  ('2c000000-0000-0000-0000-000000000004', 'attended', '{"source":"today"}', '2025-12-08 16:59 America/Los_Angeles'),
  ('2c000000-0000-0000-0000-000000000008', 'attended', '{"source":"today"}', '2025-12-08 17:00 America/Los_Angeles');

-- ── Tuesday 1 AM Pacific ────────────────────────────────────────────────────
SELECT is(public.enqueue_family_call_followups('2025-12-09 01:10 America/Los_Angeles'), 6, 'six notes');
SELECT set_eq(
  $$SELECT right(account_id::text, 1) FROM push_outbox WHERE idempotency_key LIKE 'family-call-followup:2025-12-08:%'$$,
  $$VALUES ('1'), ('2'), ('3'), ('4'), ('7'), ('8')$$,
  'a saved seat or a Join tap; not E or F, who said they can''t make it, nor I, who had no seat');
SELECT is(public.enqueue_family_call_followups('2025-12-09 01:40 America/Los_Angeles'), 0, 'one note per member per meeting');

CREATE FUNCTION pg_temp.note(p_account text) RETURNS text LANGUAGE sql AS $$
  SELECT title || ' | ' || body FROM push_outbox
  WHERE idempotency_key = 'family-call-followup:2025-12-08:2c000000-0000-0000-0000-00000000000' || p_account
$$;
SELECT is(pg_temp.note('1'),
  'Family Squares | If Monday got away from you, we missed you. Next Monday''s seat is one tap away, and members can watch recordings of past meetings.',
  'A saved her own seat and never tapped Join: the "we missed you" note');
SELECT is(pg_temp.note('2'),
  'After Monday''s call | Your one thing to try this week is on Today, and your seat for next Monday is saved automatically.',
  'B has a weekly seat and no Join tap in the app: never "we missed you", and nothing about tapping to save a seat');
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
UPDATE public.session_rsvps SET family_squares_meeting_date = '2025-12-15', status = 'going'
WHERE session_id = public.family_squares_session_id()
  AND account_id IN ('2c000000-0000-0000-0000-000000000002', '2c000000-0000-0000-0000-000000000006');
-- F stayed ten minutes this time; B again shows no sign of joining in the app.
INSERT INTO public.funnel_events(account_id, stage, metadata, created_at)
VALUES ('2c000000-0000-0000-0000-000000000006', 'attended_10min', '{"meeting_date":"2025-12-15","source":"push"}', '2025-12-15 20:10 America/Los_Angeles');
SELECT is(public.enqueue_family_call_followups('2025-12-16 01:10 America/Los_Angeles'), 2, 'the week after: B and F');
SELECT is(ARRAY(SELECT right(account_id::text, 1) || ': ' || body FROM push_outbox
    WHERE idempotency_key LIKE 'family-call-followup:2025-12-15:%' ORDER BY 1),
  ARRAY['2: This week''s one thing: Rest is part of the work.', '6: This week''s one thing: Rest is part of the work.'],
  'weekly-seat members get Matt''s line like everyone who came, week after week, whether or not the app saw them join');

SELECT * FROM finish();
ROLLBACK;
