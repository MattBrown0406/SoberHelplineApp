BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- Members who saved a seat are told once when the website cancels the coming
-- Monday (service_family_squares_announce_cancelled, 20261114120000), through
-- the same outbox and delivery rules as Tuesday's note. If the meeting is put
-- back on, a note that has not gone out is withdrawn and nothing more is sent.

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
  ('1e000000-0000-0000-0000-00000000000c', 'cn-l@example.com', now(), '{}', '{}', 'authenticated', 'authenticated')
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
  pg_get_functiondef('public.service_family_squares_note_meeting_status(date,boolean)'::regprocedure) AS note;
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

-- Cancelled a second time: nobody is told twice, sent or withdrawn.
SELECT lives_ok($$SELECT pg_temp.note_at('2026-10-01 13:00 America/New_York', true)$$, 'the website cancels it again');
SELECT is(public.family_squares_meeting_cancelled('2026-10-05'), true, '(it is cancelled)');
SELECT is(pg_temp.announce_at('2026-10-01 13:00 America/New_York'), 2,
  'only D and J, who were never told (it was too late on Monday), get a note');
SELECT is(pg_temp.notes(), ARRAY['1', '2', '4', '5', '6', '8', '9', 'a', 'c'], 'one row each, never two');
SELECT is((SELECT count(*)::integer FROM push_outbox
  WHERE idempotency_key LIKE 'family-squares-cancelled:2026-10-05:%' AND last_error = 'meeting_restored' AND failed_at IS NOT NULL), 6,
  'the six withdrawn notes stay withdrawn: nobody already queued or told is queued again');
SELECT is((SELECT count(*)::integer FROM push_outbox
  WHERE idempotency_key LIKE 'family-squares-cancelled:2026-10-05:%' AND sent_at IS NULL AND failed_at IS NULL), 2,
  'so two notes are waiting, not eight');
SELECT is(pg_temp.announce_at('2026-10-01 13:15 America/New_York'), 0, 'and the next sync adds none');
-- Recording a cancellation alone (family-squares-register does this when the
-- website tells one member) queues nothing: only the sync's reply announces.
DELETE FROM push_outbox WHERE idempotency_key LIKE 'family-squares-cancelled:2026-10-05:%';
SELECT lives_ok($$SELECT pg_temp.note_at('2026-10-01 13:30 America/New_York', true)$$, 'the status is recorded again');
SELECT is(pg_temp.notes(), ARRAY[]::text[], 'keeping the status never queues a note by itself');

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
