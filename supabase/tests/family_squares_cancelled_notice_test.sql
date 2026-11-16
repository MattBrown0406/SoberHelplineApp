BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Members who saved a seat, and members whose weekly seat had not been saved
-- yet, are told once when the website cancels the coming Monday
-- (service_family_squares_announce_cancelled, 20261114120000), through the
-- same outbox and delivery rules as Tuesday's note. If the meeting is put
-- back on, a note that has not gone out is withdrawn and nothing more is
-- sent. If it is then cancelled again, the withdrawn note is queued again.

SELECT ok(NOT has_function_privilege('anon', 'public.service_family_squares_announce_cancelled(date)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.service_family_squares_announce_cancelled(date)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.service_family_squares_announce_cancelled(date)', 'EXECUTE'),
  'only the service role (the 15-minute sync) queues the note');

-- ── Fixtures: the meeting on Monday 2026-10-05, 7 PM Pacific ────────────────
DELETE FROM public.session_rsvps;
DELETE FROM public.family_squares_meeting_status;
INSERT INTO auth.users(id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role) VALUES
  ('1e000000-0000-0000-0000-000000000001', 'cn-a@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1e000000-0000-0000-0000-000000000002', 'cn-b@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1e000000-0000-0000-0000-000000000003', 'cn-c@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1e000000-0000-0000-0000-000000000004', 'cn-d@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1e000000-0000-0000-0000-000000000005', 'cn-e@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1e000000-0000-0000-0000-000000000006', 'cn-f@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1e000000-0000-0000-0000-000000000007', 'cn-g@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1e000000-0000-0000-0000-000000000008', 'cn-h@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1e000000-0000-0000-0000-000000000009', 'cn-i@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1e000000-0000-0000-0000-00000000000a', 'cn-j@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1e000000-0000-0000-0000-00000000000b', 'cn-k@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1e000000-0000-0000-0000-00000000000c', 'cn-l@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  -- M, N, O and P: no seat and no answer until the weekly-seat section below.
  ('1e000000-0000-0000-0000-00000000000d', 'cn-m@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1e000000-0000-0000-0000-00000000000e', 'cn-n@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1e000000-0000-0000-0000-00000000000f', 'cn-o@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1e000000-0000-0000-0000-000000000000', 'cn-p@example.com', now(), '{}', '{}', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;
UPDATE public.accounts SET id = ('2e000000-0000-0000-0000-00000000000' || right(user_id::text, 1))::uuid
WHERE user_id::text LIKE '1e000000-0000-0000-0000-00000000000_';
-- Everyone: a device, Monday reminders on, English, in New York.
UPDATE public.accounts SET push_token = 'ExponentPushToken[cn-' || right(id::text, 1) || ']',
  family_call_reminders = true, locale = 'en', timezone = 'America/New_York'
WHERE id::text LIKE '2e000000-0000-0000-0000-00000000000_';
UPDATE public.accounts SET timezone = 'America/Los_Angeles' WHERE id = '2e000000-0000-0000-0000-000000000002';
UPDATE public.accounts SET locale = 'es' WHERE id = '2e000000-0000-0000-0000-000000000005';
UPDATE public.accounts SET family_call_reminders = false WHERE id = '2e000000-0000-0000-0000-000000000006';
INSERT INTO public.loved_ones(account_id, died_at, bereavement_quiet) VALUES ('2e000000-0000-0000-0000-000000000007', now(), true);
UPDATE public.accounts SET push_token = NULL WHERE id = '2e000000-0000-0000-0000-000000000008';
UPDATE public.accounts SET timezone = '' WHERE id = '2e000000-0000-0000-0000-00000000000c';

INSERT INTO public.session_rsvps(session_id, account_id, status, family_squares_meeting_date, created_at) VALUES
  -- A (New York) and B (Los Angeles) saved a seat for that Monday.
  (public.family_squares_session_id(), '2e000000-0000-0000-0000-000000000001', 'going', '2026-10-05', '2026-09-30T18:00:00Z'),
  (public.family_squares_session_id(), '2e000000-0000-0000-0000-000000000002', 'going', '2026-10-05', '2026-09-30T18:00:00Z'),
  -- C said she can't make it. D has not answered at all.
  (public.family_squares_session_id(), '2e000000-0000-0000-0000-000000000003', 'declined', '2026-10-05', '2026-09-30T18:00:00Z'),
  -- Seats, but: E is a Spanish member, F turned Monday reminders off, G paused
  -- reminders while she grieves, H has no device.
  (public.family_squares_session_id(), '2e000000-0000-0000-0000-000000000005', 'going', '2026-10-05', '2026-09-30T18:00:00Z'),
  (public.family_squares_session_id(), '2e000000-0000-0000-0000-000000000006', 'going', '2026-10-05', '2026-09-30T18:00:00Z'),
  (public.family_squares_session_id(), '2e000000-0000-0000-0000-000000000007', 'going', '2026-10-05', '2026-09-30T18:00:00Z'),
  (public.family_squares_session_id(), '2e000000-0000-0000-0000-000000000008', 'going', '2026-10-05', '2026-09-30T18:00:00Z'),
  -- I saved a seat on 4.1 (no meeting date) after the last meeting ended: it
  -- is for this Monday. J did the same before it ended: that was last week's.
  (public.family_squares_session_id(), '2e000000-0000-0000-0000-000000000009', 'going', NULL, '2026-09-28 20:01 America/Los_Angeles'),
  (public.family_squares_session_id(), '2e000000-0000-0000-0000-00000000000a', 'going', NULL, '2026-09-28 19:30 America/Los_Angeles'),
  -- K's row is still last week's meeting's.
  (public.family_squares_session_id(), '2e000000-0000-0000-0000-00000000000b', 'going', '2026-09-28', '2026-09-24T18:00:00Z'),
  -- L saved a seat and her time zone on file is blank (Pacific is assumed).
  (public.family_squares_session_id(), '2e000000-0000-0000-0000-00000000000c', 'going', '2026-10-05', '2026-09-30T18:00:00Z');

-- The two functions read the real clock. Inside this rolled-back test only,
-- their own definitions are run with the clock pinned to the week of that
-- meeting. (family_squares_meeting_cancelled still reads the real clock, for
-- which 2026-10-05 is a meeting that has ended: a status written today counts.)
CREATE TEMP TABLE defs AS SELECT
  pg_get_functiondef('public.service_family_squares_announce_cancelled(date)'::regprocedure) AS announce,
  pg_get_functiondef('public.service_family_squares_note_meeting_status(date,boolean,boolean)'::regprocedure) AS note;
CREATE FUNCTION pg_temp.announce_at(p_at text, p_meeting date DEFAULT '2026-10-05') RETURNS integer LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE replace((SELECT announce FROM defs), 'now()', quote_literal(p_at) || '::timestamptz');
  RETURN public.service_family_squares_announce_cancelled(p_meeting);
END;
$$;
CREATE FUNCTION pg_temp.note_at(p_at text, p_cancelled boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE replace((SELECT note FROM defs), 'now()', quote_literal(p_at) || '::timestamptz');
  PERFORM public.service_family_squares_note_meeting_status('2026-10-05', p_cancelled);
  -- Written "today", so the real clock believes it (see above).
  UPDATE public.family_squares_meeting_status SET noted_at = now() WHERE meeting_date = '2026-10-05';
END;
$$;
CREATE FUNCTION pg_temp.notes() RETURNS text[] LANGUAGE sql AS $$
  SELECT ARRAY(SELECT right(account_id::text, 1) FROM push_outbox
    WHERE idempotency_key LIKE 'family-squares-cancelled:2026-10-05:%' ORDER BY 1)
$$;
CREATE FUNCTION pg_temp.note_row(p_account text) RETURNS push_outbox LANGUAGE sql AS $$
  SELECT o FROM push_outbox o
  WHERE o.idempotency_key = 'family-squares-cancelled:2026-10-05:2e000000-0000-0000-0000-00000000000' || p_account
$$;

-- ── Nothing is queued unless that Monday is cancelled ───────────────────────
SELECT is(pg_temp.announce_at('2026-10-01 11:00 America/New_York'), 0, 'the website has said nothing: no note');
INSERT INTO public.family_squares_meeting_status(meeting_date, cancelled) VALUES ('2026-10-05', false);
SELECT is(pg_temp.announce_at('2026-10-01 11:00 America/New_York'), 0, 'the meeting is on: no note');
SELECT is(pg_temp.notes(), ARRAY[]::text[], 'nothing was written');

-- ── The website cancels it: Thursday, 11 AM in New York (8 AM Pacific) ──────
UPDATE public.family_squares_meeting_status SET cancelled = true, noted_at = now() WHERE meeting_date = '2026-10-05';
SELECT is(pg_temp.announce_at('2026-10-01 11:00 America/New_York', '2026-10-12'), 0, 'only ever the coming meeting');
SELECT is(pg_temp.announce_at('2026-10-01 11:00 America/New_York', NULL), 0, 'and never no meeting');
SELECT is(pg_temp.announce_at('2026-10-01 11:00 America/New_York'), 4, 'four members with a seat are told');
SELECT is(pg_temp.notes(), ARRAY['1', '2', '9', 'c'],
  'A, B, I (a 4.1 seat for this Monday) and L; not C (declined), D (no answer), E (Spanish), F (reminders off), G (paused while she grieves), H (no device), J or K (last week''s seats)');
SELECT is((SELECT row(o.kind, o.title, o.body)::text FROM pg_temp.note_row('1') o),
  row('family_call_followup', 'Family Squares', 'There''s no Family Squares this Monday. It''s back next week.')::text,
  'the note, sent as the kind Tuesday''s note uses so the same delivery rules apply');
SELECT is((SELECT o.metadata FROM pg_temp.note_row('1') o),
  '{"kind":"family_call_followup","meeting_date":"2026-10-05","notice":"cancelled"}'::jsonb, 'it opens Today, like Tuesday''s note');
SELECT is((SELECT o.scheduled_for FROM pg_temp.note_row('1') o), '2026-10-01 11:00 America/New_York'::timestamptz,
  'daytime where she is: sent now');
SELECT is((SELECT o.scheduled_for FROM pg_temp.note_row('2') o), '2026-10-01 08:00 America/Los_Angeles'::timestamptz,
  '8 AM in Los Angeles is daytime too');
SELECT is((SELECT o.scheduled_for FROM pg_temp.note_row('c') o), '2026-10-01 08:00 America/Los_Angeles'::timestamptz,
  'a blank time zone: Pacific');
SELECT is((SELECT count(DISTINCT o.expires_at)::integer FROM push_outbox o WHERE o.idempotency_key LIKE 'family-squares-cancelled:2026-10-05:%'), 1,
  'every note has the same expiry');
SELECT is((SELECT o.expires_at FROM pg_temp.note_row('1') o), '2026-10-05 19:00 America/Los_Angeles'::timestamptz,
  'never shown after the meeting would have started');

-- ── Once per member per meeting ─────────────────────────────────────────────
SELECT is(pg_temp.announce_at('2026-10-01 11:15 America/New_York'), 0, 'the next sync, 15 minutes later, queues nothing more');
SELECT is(pg_temp.announce_at('2026-10-03 12:00 America/New_York'), 0, 'nor any later one');
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE idempotency_key LIKE 'family-squares-cancelled:2026-10-05:%'), 4, 'still four notes');

-- ── Quiet hours: not at night where she is ──────────────────────────────────
-- F turns Monday reminders back on late on Thursday night (11:30 PM New York).
UPDATE public.accounts SET family_call_reminders = true WHERE id = '2e000000-0000-0000-0000-000000000006';
SELECT is(pg_temp.announce_at('2026-10-01 23:30 America/New_York'), 1, 'she is told too');
SELECT is((SELECT o.scheduled_for FROM pg_temp.note_row('6') o), '2026-10-02 08:00 America/New_York'::timestamptz,
  'at 8 AM her time, not in the night');
-- H registers a device at 5 AM on Friday.
UPDATE public.accounts SET push_token = 'ExponentPushToken[cn-8]' WHERE id = '2e000000-0000-0000-0000-000000000008';
SELECT is(pg_temp.announce_at('2026-10-02 05:00 America/New_York'), 1, 'so is she');
SELECT is((SELECT o.scheduled_for FROM pg_temp.note_row('8') o), '2026-10-02 08:00 America/New_York'::timestamptz,
  'at 8 AM, not before she is up');

-- ── Late on the Monday itself ───────────────────────────────────────────────
-- 5:30 PM Pacific is 8:30 PM in New York. D (New York) and E (now English,
-- in Los Angeles) have just saved seats.
UPDATE public.accounts SET locale = 'en', timezone = 'America/Los_Angeles' WHERE id = '2e000000-0000-0000-0000-000000000005';
INSERT INTO public.session_rsvps(session_id, account_id, status, family_squares_meeting_date, created_at)
VALUES (public.family_squares_session_id(), '2e000000-0000-0000-0000-000000000004', 'going', '2026-10-05', '2026-10-05T18:00:00Z');
SELECT is(pg_temp.announce_at('2026-10-05 17:30 America/Los_Angeles'), 1, 'one more note');
SELECT is((SELECT row(o.scheduled_for, o.expires_at)::text FROM pg_temp.note_row('5') o),
  row('2026-10-05 17:30 America/Los_Angeles'::timestamptz, '2026-10-05 19:00 America/Los_Angeles'::timestamptz)::text,
  'E, in Los Angeles, is told now, until 7 PM');
SELECT is((SELECT count(*)::integer FROM push_outbox
  WHERE idempotency_key = 'family-squares-cancelled:2026-10-05:2e000000-0000-0000-0000-000000000004'), 0,
  'D''s next morning comes after the meeting would have started: no note is queued for her');
-- Once the meeting would have started, nobody is told.
INSERT INTO public.session_rsvps(session_id, account_id, status, family_squares_meeting_date, created_at)
VALUES (public.family_squares_session_id(), '2e000000-0000-0000-0000-00000000000a', 'going', '2026-10-05', '2026-10-05T18:00:00Z')
ON CONFLICT (session_id, account_id) DO UPDATE SET family_squares_meeting_date = EXCLUDED.family_squares_meeting_date;
UPDATE public.accounts SET timezone = 'America/Los_Angeles' WHERE id = '2e000000-0000-0000-0000-00000000000a';
SELECT is(pg_temp.announce_at('2026-10-05 19:00 America/Los_Angeles'), 0, 'at 7 PM Pacific it is too late to say so');
SELECT is(pg_temp.announce_at('2026-10-05 20:00 America/Los_Angeles'), 0, 'and after it ends that Monday is no longer the coming one');
SELECT is(pg_temp.notes(), ARRAY['1', '2', '5', '6', '8', '9', 'c'], 'seven notes in all, one each');

-- ── The meeting is put back on: nothing more is sent ────────────────────────
-- A's note has gone out. The others have not.
UPDATE push_outbox SET sent_at = '2026-10-01T15:01:00Z'
WHERE idempotency_key = 'family-squares-cancelled:2026-10-05:2e000000-0000-0000-0000-000000000001';
CREATE TEMP TABLE before_restore AS SELECT count(*)::integer AS n FROM push_outbox WHERE account_id::text LIKE '2e000000-%';
SELECT lives_ok($$SELECT pg_temp.note_at('2026-10-01 12:00 America/New_York', false)$$, 'the website says the meeting is on again');
SELECT is((SELECT count(*)::integer FROM push_outbox
  WHERE idempotency_key LIKE 'family-squares-cancelled:2026-10-05:%' AND sent_at IS NULL
    AND failed_at IS NOT NULL AND last_error = 'meeting_restored' AND processing_token IS NULL), 6,
  'the six notes that had not gone out are withdrawn: they would no longer be true');
SELECT is((SELECT row(o.sent_at IS NOT NULL, o.failed_at IS NULL)::text FROM pg_temp.note_row('1') o), row(true, true)::text,
  'the one that was sent is left as it is');
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE account_id::text LIKE '2e000000-%'), (SELECT n FROM before_restore),
  'and nothing is queued to say the meeting is back');
SELECT lives_ok($$SELECT pg_temp.note_at('2026-10-01 12:15 America/New_York', false)$$, 'the next sync says "on" again');
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE account_id::text LIKE '2e000000-%'), (SELECT n FROM before_restore), 'still nothing new');
SELECT is(pg_temp.announce_at('2026-10-01 12:20 America/New_York'), 0, 'a meeting that is on is never announced as cancelled');

-- Cancelled a second time: a note withdrawn before it went out is queued
-- again. The one that was sent is never sent twice.
CREATE TEMP TABLE withdrawn AS SELECT o.id, o.expires_at FROM push_outbox o
WHERE o.idempotency_key LIKE 'family-squares-cancelled:2026-10-05:%' AND o.last_error = 'meeting_restored';
SELECT lives_ok($$SELECT pg_temp.note_at('2026-10-01 13:00 America/New_York', true)$$, 'the website cancels it again');
SELECT is(public.family_squares_meeting_cancelled('2026-10-05'), true, '(it is cancelled)');
SELECT is(pg_temp.announce_at('2026-10-01 13:00 America/New_York'), 8,
  'the six withdrawn notes are queued again, and D and J, who were never told (it was too late on Monday), get theirs');
SELECT is(pg_temp.notes(), ARRAY['1', '2', '4', '5', '6', '8', '9', 'a', 'c'], 'one row each, never two');
SELECT is((SELECT count(*)::integer FROM push_outbox o JOIN withdrawn w ON w.id = o.id
  WHERE o.sent_at IS NULL AND o.failed_at IS NULL AND o.last_error IS NULL AND o.attempt_count = 0
    AND o.processing_token IS NULL AND o.expires_at = w.expires_at), 6,
  'the same six rows, with the withdrawal cleared and the 7 PM expiry they always had');
SELECT is((SELECT count(*)::integer FROM push_outbox
  WHERE idempotency_key LIKE 'family-squares-cancelled:2026-10-05:%' AND sent_at IS NULL AND failed_at IS NULL), 8,
  'so eight notes are waiting');
SELECT is((SELECT o.scheduled_for FROM pg_temp.note_row('6') o), '2026-10-01 13:00 America/New_York'::timestamptz,
  'due when a new note would be: F''s had been set for 8 AM the next morning, and it is daytime now');
SELECT is((SELECT row(o.sent_at, o.failed_at IS NULL, o.scheduled_for)::text FROM pg_temp.note_row('1') o),
  row('2026-10-01T15:01:00Z'::timestamptz, true, '2026-10-01 11:00 America/New_York'::timestamptz)::text,
  'A was already told: her row is untouched and she is not told twice');
SELECT is(pg_temp.announce_at('2026-10-01 13:15 America/New_York'), 0, 'and the next sync adds none');
-- On again, then off again late on the Monday itself (5:30 PM Pacific, 8:30 PM
-- in New York): a withdrawn note comes back only where a new one would be
-- queued.
SELECT lives_ok($$SELECT pg_temp.note_at('2026-10-05 17:00 America/Los_Angeles', false)$$, 'on again');
SELECT is((SELECT count(*)::integer FROM push_outbox
  WHERE idempotency_key LIKE 'family-squares-cancelled:2026-10-05:%' AND sent_at IS NULL AND last_error = 'meeting_restored'), 8,
  'the eight waiting notes are withdrawn');
SELECT lives_ok($$SELECT pg_temp.note_at('2026-10-05 17:30 America/Los_Angeles', true)$$, 'and off again');
SELECT is(pg_temp.announce_at('2026-10-05 17:30 America/Los_Angeles'), 4, 'four notes are queued again');
SELECT is(ARRAY(SELECT right(account_id::text, 1) FROM push_outbox
    WHERE idempotency_key LIKE 'family-squares-cancelled:2026-10-05:%' AND sent_at IS NULL AND failed_at IS NULL ORDER BY 1),
  ARRAY['2', '5', 'a', 'c'], 'for the members on Pacific time, where it is still daytime');
SELECT is(ARRAY(SELECT right(account_id::text, 1) FROM push_outbox
    WHERE idempotency_key LIKE 'family-squares-cancelled:2026-10-05:%' AND last_error = 'meeting_restored' AND failed_at IS NOT NULL ORDER BY 1),
  ARRAY['4', '6', '8', '9'], 'in New York her next morning comes after 7 PM Pacific: those four stay withdrawn');
SELECT is(pg_temp.notes(), ARRAY['1', '2', '4', '5', '6', '8', '9', 'a', 'c'], 'still one row each');
-- Recording a cancellation alone (family-squares-register does this when the
-- website tells one member) queues nothing: only the sync's reply announces.
DELETE FROM push_outbox WHERE idempotency_key LIKE 'family-squares-cancelled:2026-10-05:%';
SELECT lives_ok($$SELECT pg_temp.note_at('2026-10-01 13:30 America/New_York', true)$$, 'the status is recorded again');
SELECT is(pg_temp.notes(), ARRAY[]::text[], 'keeping the status never queues a note by itself');

-- ── A weekly seat that had not been saved yet ───────────────────────────────
-- The Monday was cancelled before this week's seats were saved, and no seat
-- is saved while it is cancelled: these members have no RSVP row for it and
-- would never hear. K, M, N, O and P have "Save my seat every Monday" on.
UPDATE public.accounts SET family_squares_weekly_seat = true, family_squares_weekly_seat_set_at = now()
WHERE id IN ('2e000000-0000-0000-0000-00000000000b', '2e000000-0000-0000-0000-00000000000d',
  '2e000000-0000-0000-0000-00000000000e', '2e000000-0000-0000-0000-00000000000f', '2e000000-0000-0000-0000-000000000000');
-- N said she can't make it this week. The website refused O for this meeting.
-- P has shown no sign of using the app for more than 180 days. K's row is
-- still last week's (the Tuesday reset has not cleared it yet).
INSERT INTO public.session_rsvps(session_id, account_id, status, family_squares_meeting_date, created_at)
VALUES (public.family_squares_session_id(), '2e000000-0000-0000-0000-00000000000e', 'declined', '2026-10-05', '2026-09-30T18:00:00Z');
INSERT INTO public.family_squares_weekly_seat_holds(account_id, meeting_date, reason)
VALUES ('2e000000-0000-0000-0000-00000000000f', '2026-10-05', 'registration_unavailable');
UPDATE public.accounts SET family_squares_weekly_seat_set_at = now() - interval '200 days', push_token_seen_at = now() - interval '200 days'
WHERE id = '2e000000-0000-0000-0000-000000000000';
CREATE FUNCTION pg_temp.weekly_notes() RETURNS text[] LANGUAGE sql AS $$
  SELECT ARRAY(SELECT right(account_id::text, 1) FROM push_outbox
    WHERE idempotency_key LIKE 'family-squares-cancelled:2026-10-05:%'
      AND account_id IN ('2e000000-0000-0000-0000-00000000000b', '2e000000-0000-0000-0000-00000000000d',
        '2e000000-0000-0000-0000-00000000000e', '2e000000-0000-0000-0000-00000000000f', '2e000000-0000-0000-0000-000000000000')
    ORDER BY 1)
$$;
SELECT is(pg_temp.announce_at('2026-10-01 13:30 America/New_York'), 10, 'the nine with a seat, and M');
SELECT is(pg_temp.weekly_notes(), ARRAY['d'],
  'M has a weekly seat and no row yet: she is told. Not N (she said she can''t make it), O (the website refused her), P (no sign of app use in 180 days) or K (last week''s row is still there)');
SELECT is((SELECT count(*)::integer FROM push_outbox
  WHERE idempotency_key = 'family-squares-cancelled:2026-10-05:2e000000-0000-0000-0000-000000000004'), 1,
  '(D has a seat by now. Without one, and without a weekly seat, she was not told: see the first announcement above)');
SELECT is((SELECT row(o.kind, o.title, o.body, o.metadata ->> 'notice', o.scheduled_for, o.expires_at)::text FROM pg_temp.note_row('d') o),
  row('family_call_followup', 'Family Squares', 'There''s no Family Squares this Monday. It''s back next week.', 'cancelled',
    '2026-10-01 13:30 America/New_York'::timestamptz, '2026-10-05 19:00 America/Los_Angeles'::timestamptz)::text,
  'the same note, under the same key, at the same hours');
SELECT is(pg_temp.announce_at('2026-10-01 13:45 America/New_York'), 0, 'once: the next sync queues nothing more');
-- The same rules as for saving a weekly seat, as each one changes.
DELETE FROM public.session_rsvps WHERE account_id = '2e000000-0000-0000-0000-00000000000b';
SELECT is(pg_temp.announce_at('2026-10-01 14:00 America/New_York'), 1, 'the Tuesday reset clears K''s old row: she is told');
UPDATE public.accounts SET push_token_seen_at = now() WHERE id = '2e000000-0000-0000-0000-000000000000';
SELECT is(pg_temp.announce_at('2026-10-01 14:15 America/New_York'), 1, 'P opens the app again: she is told');
UPDATE public.family_squares_weekly_seat_holds SET reason = 'no_answer', noted_at = now() - interval '5 hours'
WHERE account_id = '2e000000-0000-0000-0000-00000000000f';
SELECT is(pg_temp.announce_at('2026-10-01 14:30 America/New_York'), 0, 'the website could not answer for O in the last six hours: not yet');
UPDATE public.family_squares_weekly_seat_holds SET noted_at = now() - interval '7 hours'
WHERE account_id = '2e000000-0000-0000-0000-00000000000f';
SELECT is(pg_temp.announce_at('2026-10-01 14:45 America/New_York'), 1, 'longer ago than that: she is told');
SELECT is(pg_temp.weekly_notes(), ARRAY['0', 'b', 'd', 'f'], 'one note each; N, who declined, is never told');
-- Turning the weekly seat off, or the exclusions every seat holder has.
DELETE FROM push_outbox WHERE idempotency_key LIKE 'family-squares-cancelled:2026-10-05:%';
UPDATE public.accounts SET family_squares_weekly_seat = false WHERE id = '2e000000-0000-0000-0000-00000000000b';
UPDATE public.accounts SET family_call_reminders = false WHERE id = '2e000000-0000-0000-0000-00000000000d';
UPDATE public.accounts SET locale = 'es' WHERE id = '2e000000-0000-0000-0000-00000000000f';
INSERT INTO public.loved_ones(account_id, died_at, bereavement_quiet) VALUES ('2e000000-0000-0000-0000-000000000000', now(), true);
SELECT is(pg_temp.announce_at('2026-10-01 15:00 America/New_York'), 9, 'only the nine with a seat');
SELECT is(pg_temp.weekly_notes(), ARRAY[]::text[],
  'not K (weekly seat off), M (Monday reminders off), O (a Spanish member) or P (paused while she grieves)');
DELETE FROM push_outbox WHERE idempotency_key LIKE 'family-squares-cancelled:2026-10-05:%';

-- ── Delivery: the rules Tuesday's note has (real clock) ─────────────────────
CREATE TEMP TABLE zones AS SELECT
  (SELECT name FROM pg_timezone_names WHERE name LIKE 'Etc/GMT%' AND (now() AT TIME ZONE name)::time BETWEEN '10:00' AND '18:00' ORDER BY name LIMIT 1) AS day_tz,
  (SELECT name FROM pg_timezone_names WHERE name LIKE 'Etc/GMT%' AND (now() AT TIME ZONE name)::time BETWEEN '01:00' AND '05:00' ORDER BY name LIMIT 1) AS night_tz;
UPDATE public.accounts SET timezone = (SELECT day_tz FROM zones)
WHERE id IN ('2e000000-0000-0000-0000-000000000001', '2e000000-0000-0000-0000-000000000007');
UPDATE public.accounts SET timezone = (SELECT night_tz FROM zones) WHERE id = '2e000000-0000-0000-0000-000000000002';
-- Rows shaped exactly like the note, claimed by a worker.
INSERT INTO push_outbox(account_id, kind, title, body, metadata, idempotency_key, scheduled_for, expires_at, processing_at, processing_token)
SELECT a.id, 'family_call_followup', 'Family Squares', 'There''s no Family Squares this Monday. It''s back next week.',
  '{"kind":"family_call_followup","meeting_date":"2026-10-05","notice":"cancelled"}',
  'family-squares-cancelled:2026-10-05:' || a.id, now() - interval '1 minute', now() + interval '6 hours',
  now(), 'dd7e0000-0000-0000-0000-000000000001'
FROM public.accounts a
WHERE a.id IN ('2e000000-0000-0000-0000-000000000001', '2e000000-0000-0000-0000-000000000002', '2e000000-0000-0000-0000-000000000007');
CREATE FUNCTION pg_temp.deliver(p_account text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT dispatcher_outbox_delivery(o.id, 'dd7e0000-0000-0000-0000-000000000001') FROM pg_temp.note_row(p_account) o
$$;
SELECT is(pg_temp.deliver('1') ->> 'push_token', 'ExponentPushToken[cn-1]', 'delivered in her daytime');
SELECT is(pg_temp.deliver('2'), NULL::jsonb, 'never in her night');
SELECT is(pg_temp.deliver('7'), NULL::jsonb, 'not while she has paused reminders to grieve');
UPDATE public.accounts SET locale = 'es' WHERE id = '2e000000-0000-0000-0000-000000000001';
SELECT is(pg_temp.deliver('1'), NULL::jsonb, 'not to a Spanish member');
UPDATE public.accounts SET locale = 'en', family_call_reminders = false WHERE id = '2e000000-0000-0000-0000-000000000001';
SELECT is(pg_temp.deliver('1'), NULL::jsonb, 'not after she switched Monday reminders off');
UPDATE public.accounts SET family_call_reminders = true WHERE id = '2e000000-0000-0000-0000-000000000001';
SELECT isnt(pg_temp.deliver('1'), NULL::jsonb, 'on again: delivered');
-- Withdrawn exactly as service_family_squares_note_meeting_status withdraws it.
UPDATE push_outbox SET failed_at = now(), last_error = 'meeting_restored', processing_at = NULL, processing_token = NULL
WHERE idempotency_key = 'family-squares-cancelled:2026-10-05:2e000000-0000-0000-0000-000000000001';
SELECT is((SELECT dispatcher_outbox_delivery(o.id, 'dd7e0000-0000-0000-0000-000000000001') FROM pg_temp.note_row('1') o), NULL::jsonb,
  'a withdrawn note is never delivered, even to a worker that had already claimed it');

SELECT * FROM finish();
ROLLBACK;
