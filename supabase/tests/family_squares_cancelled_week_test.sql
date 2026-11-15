BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- A Monday the website cancelled is not announced (20261114150000): the
-- hour-before reminder and the 6:30 PM invite stay quiet, and come back when
-- the meeting is put back on. The Tuesday note is checked in
-- family_squares_missed_followup_test, the weekly seat and the status helpers
-- in family_squares_weekly_seat_test.

SELECT ok(NOT has_function_privilege('anon', 'public.dispatcher_job_delivery(text,uuid,uuid,timestamptz,timestamptz,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.dispatcher_job_delivery(text,uuid,uuid,timestamptz,timestamptz,boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.dispatcher_job_delivery(text,uuid,uuid,timestamptz,timestamptz,boolean)', 'EXECUTE'),
  'the delivery rules stay service-role only');

-- ── Fixtures: the meeting on Monday 2026-10-05, 7 PM Pacific (02:00 UTC on the 6th) ──
DELETE FROM public.session_rsvps;
DELETE FROM public.family_squares_meeting_status;
INSERT INTO auth.users(id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role) VALUES
  ('1d000000-0000-0000-0000-000000000001', 'cw-a@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1d000000-0000-0000-0000-000000000002', 'cw-b@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1d000000-0000-0000-0000-000000000003', 'cw-c@example.com', now(), '{}', '{}', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;
UPDATE public.accounts SET id = ('2d000000-0000-0000-0000-00000000000' || right(user_id::text, 1))::uuid,
  locale = 'en', timezone = 'America/New_York', family_call_reminders = true, daily_push_opt_in = true,
  created_at = '2026-09-01T00:00:00Z',
  push_token = 'ExponentPushToken[cw-' || right(user_id::text, 1) || ']'
WHERE user_id::text LIKE '1d000000-0000-0000-0000-00000000000_';
-- A saved her seat (before any cancellation). B has not answered. C is only
-- here for the winback note.
INSERT INTO public.session_rsvps(session_id, account_id, status, family_squares_meeting_date, created_at)
VALUES (public.family_squares_session_id(), '2d000000-0000-0000-0000-000000000001', 'going', '2026-10-05', '2026-10-01T18:00:00Z');

CREATE FUNCTION pg_temp.call(k text, a text, at_time timestamptz, forced boolean DEFAULT false) RETURNS jsonb LANGUAGE sql AS $$
  SELECT dispatcher_job_delivery(k, ('2d000000-0000-0000-0000-00000000000' || a)::uuid,
    family_squares_session_id(), '2026-10-06T02:00:00Z', at_time, forced)
$$;
CREATE FUNCTION pg_temp.targets(k text, at_time timestamptz) RETURNS text[] LANGUAGE sql AS $$
  SELECT ARRAY(SELECT right(t.account_id::text, 1) FROM dispatcher_job_targets(k, false, NULL, at_time) t
    WHERE t.account_id::text LIKE '2d000000-%' ORDER BY 1)
$$;
CREATE FUNCTION pg_temp.winback(at_time timestamptz) RETURNS jsonb LANGUAGE sql AS $$
  SELECT dispatcher_job_delivery('winback', '2d000000-0000-0000-0000-000000000003', NULL, at_time + interval '24 hours', at_time)
$$;

-- ── The meeting is on: both pushes go out as they always did ────────────────
SELECT ok(pg_temp.call('session_reminder', '1', '2026-10-06T01:05:00Z') IS NOT NULL, 'on: A gets "starts in about an hour and your seat is saved"');
SELECT ok(pg_temp.call('family_call_30min', '2', '2026-10-06T01:32:00Z') IS NOT NULL, 'on: B gets "starts in 30 minutes"');
SELECT is(pg_temp.targets('session_reminder', '2026-10-06T01:05:00Z'), ARRAY['1'], 'on: A is picked for the reminder');
SELECT is(pg_temp.targets('family_call_30min', '2026-10-06T01:32:00Z'), ARRAY['2', '3'], 'on: everyone without a seat is picked for the invite');
SELECT ok(pg_temp.call('session_reminder', '1', '2026-10-03T18:00:00Z', true) IS NOT NULL, 'on: an operator preview on Saturday resolves that Monday');
SELECT ok(pg_temp.call('family_call_30min', '2', '2026-10-03T18:00:00Z', true) IS NOT NULL, 'on: and previews the invite');
SELECT ok(pg_temp.winback('2026-10-06T16:00:00Z') IS NOT NULL, 'the winback note is due for C');

-- The website said so about other Mondays, or said this one is on: no effect.
INSERT INTO public.family_squares_meeting_status(meeting_date, cancelled) VALUES
  ('2026-09-28', true), ('2026-10-12', true), ('2026-10-05', false);
SELECT ok(pg_temp.call('session_reminder', '1', '2026-10-06T01:05:00Z') IS NOT NULL, 'another Monday cancelled: this one is still announced');
SELECT ok(pg_temp.call('family_call_30min', '2', '2026-10-06T01:32:00Z') IS NOT NULL, 'and still invited to');

-- ── The website cancels Monday 2026-10-05 ───────────────────────────────────
UPDATE public.family_squares_meeting_status SET cancelled = true, noted_at = now() WHERE meeting_date = '2026-10-05';
SELECT is(public.family_squares_meeting_cancelled('2026-10-05'), true, 'the website cancelled that Monday');
SELECT is(pg_temp.call('session_reminder', '1', '2026-10-06T01:05:00Z'), NULL,
  'cancelled: no "your seat is saved" reminder, though her seat was saved before the cancellation');
SELECT is(pg_temp.call('family_call_30min', '2', '2026-10-06T01:32:00Z'), NULL, 'cancelled: no "starts in 30 minutes" invite');
SELECT is(pg_temp.targets('session_reminder', '2026-10-06T01:05:00Z'), ARRAY[]::text[], 'cancelled: nobody is picked for the reminder');
SELECT is(pg_temp.targets('family_call_30min', '2026-10-06T01:32:00Z'), ARRAY[]::text[], 'cancelled: nobody is picked for the invite');
SELECT is(pg_temp.call('session_reminder', '1', '2026-10-03T18:00:00Z', true), NULL, 'cancelled: a forced run does not announce it either');
SELECT is(pg_temp.call('family_call_30min', '2', '2026-10-03T18:00:00Z', true), NULL, 'nor force the invite');
SELECT is((SELECT status FROM public.session_rsvps WHERE account_id = '2d000000-0000-0000-0000-000000000001'), 'going',
  'her seat is left as it was: nothing is deleted');
SELECT ok(pg_temp.winback('2026-10-06T16:00:00Z') IS NOT NULL, 'cancelled: the winback note is not a Family Squares push and still goes out');

-- ── If the status cannot be read, the pushes go out as before ───────────────
ALTER TABLE public.family_squares_meeting_status RENAME COLUMN cancelled TO unreadable;
SELECT is(public.family_squares_meeting_cancelled('2026-10-05'), false, 'a failed lookup answers "not cancelled" instead of raising');
SELECT ok(pg_temp.call('session_reminder', '1', '2026-10-06T01:05:00Z') IS NOT NULL, 'so the reminder is sent');
SELECT ok(pg_temp.call('family_call_30min', '2', '2026-10-06T01:32:00Z') IS NOT NULL, 'and the invite');
ALTER TABLE public.family_squares_meeting_status RENAME COLUMN unreadable TO cancelled;
SELECT is(pg_temp.call('session_reminder', '1', '2026-10-06T01:05:00Z'), NULL, 'readable again: quiet again');

-- ── The meeting is put back on ──────────────────────────────────────────────
UPDATE public.family_squares_meeting_status SET cancelled = false, noted_at = now() WHERE meeting_date = '2026-10-05';
SELECT ok(pg_temp.call('session_reminder', '1', '2026-10-06T01:05:00Z') IS NOT NULL, 'back on: the reminder is sent again');
SELECT ok(pg_temp.call('family_call_30min', '2', '2026-10-06T01:32:00Z') IS NOT NULL, 'back on: so is the invite');

-- ── Every other rule still applies ──────────────────────────────────────────
UPDATE public.accounts SET family_call_reminders = false WHERE id = '2d000000-0000-0000-0000-000000000001';
SELECT is(pg_temp.call('session_reminder', '1', '2026-10-06T01:05:00Z'), NULL, 'the reminder switch is still obeyed');
UPDATE public.accounts SET family_call_reminders = true, locale = 'es' WHERE id = '2d000000-0000-0000-0000-000000000001';
SELECT is(pg_temp.call('session_reminder', '1', '2026-10-06T01:05:00Z'), NULL, 'Spanish members are still invited to La Sobremesa instead');
UPDATE public.accounts SET locale = 'en' WHERE id = '2d000000-0000-0000-0000-000000000001';
INSERT INTO public.loved_ones(account_id, died_at, bereavement_quiet) VALUES ('2d000000-0000-0000-0000-000000000002', now(), true);
SELECT is(pg_temp.call('family_call_30min', '2', '2026-10-06T01:32:00Z'), NULL, 'the bereavement pause is still obeyed');
SELECT is(pg_temp.call('session_reminder', '1', '2026-10-06T01:16:00Z'), NULL, 'and the send window: never after 6:15 PM');

-- ── "Cancelled" is believed only while it is fresh ──────────────────────────
-- The sync repeats the website's answer every 15 minutes. If it stops after a
-- cancellation and the website later puts the meeting back on, an old
-- "cancelled" must not keep that Monday silent: after six hours nobody knows,
-- and that is "not cancelled". This rule reads the real clock, so it is
-- checked against the real coming Monday.
CREATE TEMP TABLE coming AS SELECT public._family_squares_coming_meeting_date(now()) AS d;
CREATE FUNCTION pg_temp.coming_call(k text, a text, minutes_before integer) RETURNS jsonb LANGUAGE sql AS $$
  SELECT dispatcher_job_delivery(k, ('2d000000-0000-0000-0000-00000000000' || a)::uuid, family_squares_session_id(),
    ((SELECT d FROM coming) + time '19:00') AT TIME ZONE 'America/Los_Angeles',
    (((SELECT d FROM coming) + time '19:00') AT TIME ZONE 'America/Los_Angeles') - make_interval(mins => minutes_before))
$$;
SELECT ok(pg_temp.coming_call('session_reminder', '1', 55) IS NOT NULL, 'the coming Monday, nothing said: A''s reminder is due');
SELECT ok(pg_temp.coming_call('family_call_30min', '3', 28) IS NOT NULL, 'and C''s invite');
INSERT INTO public.family_squares_meeting_status(meeting_date, cancelled, noted_at) VALUES ((SELECT d FROM coming), true, now());
SELECT is(pg_temp.coming_call('session_reminder', '1', 55), NULL, 'cancelled a moment ago: no reminder');
SELECT is(pg_temp.coming_call('family_call_30min', '3', 28), NULL, 'and no invite');
UPDATE public.family_squares_meeting_status SET noted_at = now() - interval '5 hours 50 minutes' WHERE meeting_date = (SELECT d FROM coming);
SELECT is(pg_temp.coming_call('session_reminder', '1', 55), NULL, 'last heard just under six hours ago: still quiet');
UPDATE public.family_squares_meeting_status SET noted_at = now() - interval '6 hours 10 minutes' WHERE meeting_date = (SELECT d FROM coming);
SELECT is(public.family_squares_meeting_cancelled((SELECT d FROM coming)), false, 'last heard more than six hours ago: not believed any more');
SELECT ok(pg_temp.coming_call('session_reminder', '1', 55) IS NOT NULL, 'so the reminder goes out, as it always did');
SELECT ok(pg_temp.coming_call('family_call_30min', '3', 28) IS NOT NULL, 'and the invite');
SELECT is(pg_temp.targets('session_reminder',
    (((SELECT d FROM coming) + time '19:00') AT TIME ZONE 'America/Los_Angeles') - interval '55 minutes'), ARRAY['1'],
  'and A is picked for it again');
UPDATE public.family_squares_meeting_status SET noted_at = now() WHERE meeting_date = (SELECT d FROM coming);
SELECT is(pg_temp.coming_call('session_reminder', '1', 55), NULL, 'the sync works again and still says cancelled: quiet at once');
-- A meeting that has ended is judged by what was last heard on its own day
-- (2026-10-05 above was written just now, long after it ended).
UPDATE public.family_squares_meeting_status SET cancelled = true, noted_at = '2026-10-05 19:45 America/Los_Angeles' WHERE meeting_date = '2026-10-05';
SELECT is(public.family_squares_meeting_cancelled('2026-10-05'), true, 'a past Monday: the last answer before it ended stands, however old');
UPDATE public.family_squares_meeting_status SET noted_at = '2026-10-04 23:59 America/Los_Angeles' WHERE meeting_date = '2026-10-05';
SELECT is(public.family_squares_meeting_cancelled('2026-10-05'), false, 'but not one last heard before the day of the meeting');

SELECT * FROM finish();
ROLLBACK;
