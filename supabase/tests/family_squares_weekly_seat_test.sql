BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- ── Privileges ──────────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon', 'public.set_family_squares_weekly_seat(boolean)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.set_family_squares_weekly_seat(boolean)', 'EXECUTE'),
  'only a signed-in member sets her weekly seat');
SELECT ok(NOT has_function_privilege('anon', 'public.decline_family_squares_rsvp()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.decline_family_squares_rsvp()', 'EXECUTE'),
  'only a signed-in member declines');
SELECT ok(NOT has_function_privilege('anon', 'public._family_squares_restore_weekly_seats(date)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._family_squares_restore_weekly_seats(date)', 'EXECUTE'),
  'clients cannot save seats for everyone');
SELECT ok(NOT has_function_privilege('anon', 'public.reset_family_squares_weekly_rsvps()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.reset_family_squares_weekly_rsvps()', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.reset_family_squares_weekly_rsvps()', 'EXECUTE'),
  'the weekly reset stays service-role only');
SELECT ok(has_column_privilege('authenticated', 'public.accounts', 'family_squares_weekly_seat', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.accounts', 'family_squares_weekly_seat', 'UPDATE'),
  'she reads the preference directly and changes it only through the function');

-- ── Fixtures ────────────────────────────────────────────────────────────────
DELETE FROM public.session_rsvps;
DELETE FROM public.family_squares_meeting_stats;
INSERT INTO auth.users(id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role) VALUES
  ('1b000000-0000-0000-0000-000000000001', 'seat-a@example.com', now(), '{}', '{"first_name":"Ana"}', 'authenticated', 'authenticated'),
  ('1b000000-0000-0000-0000-000000000002', 'seat-b@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1b000000-0000-0000-0000-000000000003', 'seat-unverified@example.com', NULL, '{}', '{}', 'authenticated', 'authenticated'),
  ('1b000000-0000-0000-0000-000000000004', 'seat-es@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1b000000-0000-0000-0000-000000000005', 'seat-off@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1b000000-0000-0000-0000-000000000006', 'seat-declined@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1b000000-0000-0000-0000-000000000007', 'seat-early@example.com', now(), '{}', '{}', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;
UPDATE public.accounts SET id = ('2b000000-0000-0000-0000-00000000000' || right(user_id::text, 1))::uuid,
  locale = 'en', timezone = 'America/New_York', family_call_reminders = true,
  push_token = 'ExponentPushToken[seat-' || right(user_id::text, 1) || ']'
WHERE user_id::text LIKE '1b000000-0000-0000-0000-00000000000_';
UPDATE public.accounts SET locale = 'es' WHERE id = '2b000000-0000-0000-0000-000000000004';
SELECT is((SELECT count(*)::integer FROM public.accounts WHERE id::text LIKE '2b000000-%' AND family_squares_weekly_seat), 0,
  'the weekly seat is off until she asks for it');

-- The Monday call checks use fixed Monday-evening clocks (New York daytime):
-- the call on Monday 2026-10-05 at 7 PM Pacific (02:00 UTC on the 6th).
CREATE FUNCTION pg_temp.call(k text, a uuid, at_time timestamptz) RETURNS jsonb LANGUAGE sql AS $$
  SELECT dispatcher_job_delivery(k, a, family_squares_session_id(), '2026-10-06T02:00:00Z', at_time)
$$;

-- ── The preference: her own account only ────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"1b000000-0000-0000-0000-000000000001","email":"seat-a@example.com","role":"authenticated"}', true);
SELECT throws_ok($$SELECT public.set_family_squares_weekly_seat(NULL)$$, '22023', 'invalid_preference', 'on or off, nothing else');
SELECT is(public.set_family_squares_weekly_seat(true), true, 'A asks for her seat every Monday');
SELECT is((SELECT family_squares_weekly_seat FROM public.accounts WHERE user_id = auth.uid()), true, 'and can read it back');
SELECT throws_ok($$UPDATE public.accounts SET family_squares_weekly_seat = false WHERE user_id = auth.uid()$$,
  '42501', NULL, 'the column cannot be written directly');
SELECT set_config('request.jwt.claims', '{"sub":"1b000000-0000-0000-0000-000000000009","email":"nobody@example.com","role":"authenticated"}', true);
SELECT throws_ok($$SELECT public.set_family_squares_weekly_seat(true)$$, '28000', 'no_account', 'a sign-in without an account changes nothing');
SELECT throws_ok($$SELECT public.decline_family_squares_rsvp()$$, '28000', 'no_account', 'and cannot decline');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT is(ARRAY(SELECT right(id::text, 1) FROM public.accounts WHERE id::text LIKE '2b000000-%' AND family_squares_weekly_seat ORDER BY 1),
  ARRAY['1'], 'only A''s preference changed');

-- ── "Can't make it this week" ───────────────────────────────────────────────
INSERT INTO public.session_rsvps(session_id, account_id, status, family_squares_meeting_date, created_at) VALUES
  (public.family_squares_session_id(), '2b000000-0000-0000-0000-000000000001', 'going', '2026-10-05', now() - interval '2 hours'),
  (public.family_squares_session_id(), '2b000000-0000-0000-0000-000000000002', 'going', '2026-10-05', now() - interval '2 hours');
-- Another session she is going to must not be touched.
INSERT INTO public.session_rsvps(session_id, account_id, status)
SELECT s.id, '2b000000-0000-0000-0000-000000000001', 'going' FROM public.sessions s
WHERE s.id <> public.family_squares_session_id() ORDER BY s.created_at LIMIT 1;

SELECT ok(pg_temp.call('session_reminder', '2b000000-0000-0000-0000-000000000001', '2026-10-06T01:05:00Z') IS NOT NULL,
  'going: the hour-before reminder is sent');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"1b000000-0000-0000-0000-000000000001","email":"seat-a@example.com","role":"authenticated"}', true);
SELECT is(public.decline_family_squares_rsvp(), true, 'A says she can''t make it');
SELECT is(public.decline_family_squares_rsvp(), false, 'declining twice changes nothing');
SELECT set_config('request.jwt.claims', '{"sub":"1b000000-0000-0000-0000-000000000005","email":"seat-off@example.com","role":"authenticated"}', true);
SELECT is(public.decline_family_squares_rsvp(), false, 'no saved seat: nothing to decline');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT is((SELECT row(status, family_squares_meeting_date)::text FROM public.session_rsvps
  WHERE session_id = public.family_squares_session_id() AND account_id = '2b000000-0000-0000-0000-000000000001'),
  row('declined', '2026-10-05'::date)::text, 'her RSVP is declined for the same meeting');
SELECT is((SELECT status FROM public.session_rsvps
  WHERE session_id = public.family_squares_session_id() AND account_id = '2b000000-0000-0000-0000-000000000002'),
  'going', 'nobody else''s RSVP changed');
SELECT is((SELECT count(*)::integer FROM public.session_rsvps
  WHERE session_id <> public.family_squares_session_id() AND account_id = '2b000000-0000-0000-0000-000000000001' AND status = 'declined'),
  0, 'her other sessions are untouched');
SELECT is(pg_temp.call('session_reminder', '2b000000-0000-0000-0000-000000000001', '2026-10-06T01:05:00Z'), NULL,
  'declined: no "your seat is saved" reminder');
SELECT is(pg_temp.call('family_call_30min', '2b000000-0000-0000-0000-000000000001', '2026-10-06T01:32:00Z'), NULL,
  'declined: the 6:30 PM invite does not nag her either');
SELECT ok(pg_temp.call('family_call_30min', '2b000000-0000-0000-0000-000000000005', '2026-10-06T01:32:00Z') IS NOT NULL,
  'someone who has not answered still gets the 6:30 PM invite');
SELECT is((SELECT rsvp FROM public.service_family_squares_attendees(now() - interval '1 day') WHERE email = 'seat-a@example.com'),
  'declined', 'the website hears that she declined');

-- ── Saving next Monday's seat for everyone who asked ────────────────────────
DELETE FROM public.session_rsvps;
UPDATE public.accounts SET family_squares_weekly_seat = true
WHERE id IN ('2b000000-0000-0000-0000-000000000001', '2b000000-0000-0000-0000-000000000003',
  '2b000000-0000-0000-0000-000000000004', '2b000000-0000-0000-0000-000000000006', '2b000000-0000-0000-0000-000000000007');
-- Answered for next Monday already (Monday night, after the call): kept as they are.
INSERT INTO public.session_rsvps(session_id, account_id, status, family_squares_meeting_date, created_at) VALUES
  (public.family_squares_session_id(), '2b000000-0000-0000-0000-000000000006', 'declined', '2026-11-23', now() - interval '3 hours'),
  (public.family_squares_session_id(), '2b000000-0000-0000-0000-000000000007', 'going', '2026-11-23', now() - interval '3 hours');

SELECT is(public._family_squares_restore_weekly_seats('2026-11-23'), 1, 'one new seat: the verified English member who asked and had not answered');
SELECT is(public._family_squares_restore_weekly_seats('2026-11-23'), 0, 'running it again adds nothing');
SELECT is(public._family_squares_restore_weekly_seats(NULL), 0, 'no meeting date: nothing');
SELECT is((SELECT row(status, family_squares_meeting_date)::text FROM public.session_rsvps
  WHERE session_id = public.family_squares_session_id() AND account_id = '2b000000-0000-0000-0000-000000000001'),
  row('going', '2026-11-23'::date)::text, 'A''s seat is saved and dated like a seat she saved herself');
SELECT is(ARRAY(SELECT right(account_id::text, 1) || ':' || status FROM public.session_rsvps
  WHERE session_id = public.family_squares_session_id() ORDER BY 1),
  ARRAY['1:going', '6:declined', '7:going'],
  'unverified, Spanish and not-asked accounts get no seat; an earlier "can''t make it" is respected');
SELECT is((SELECT row(name, rsvp)::text FROM public.service_family_squares_attendees(now() - interval '1 day') WHERE email = 'seat-a@example.com'),
  row('Ana', 'going')::text, 'the website sync carries the saved seat like any RSVP');
SELECT ok(pg_temp.call('session_reminder', '2b000000-0000-0000-0000-000000000001', '2026-10-06T01:05:00Z') IS NOT NULL,
  'the hour-before reminder treats the saved seat like any RSVP');
SELECT is(pg_temp.call('family_call_30min', '2b000000-0000-0000-0000-000000000001', '2026-10-06T01:32:00Z'), NULL,
  'and she is not also sent the invite for people without a seat');

-- ── The whole Tuesday reset ─────────────────────────────────────────────────
-- Force the real reset definition's clock inside this rolled-back test only:
-- Tuesday 2026-11-17, 2:00 AM Pacific, after Monday 2026-11-16's meeting.
DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.reset_family_squares_weekly_rsvps()'::regprocedure) INTO definition;
  EXECUTE replace(definition, 'clock_timestamp()', '''2026-11-17T10:00:00Z''::timestamptz');
END $$;
DELETE FROM public.session_rsvps;
-- La Sobremesa links are cleared by the same reset: keep them out of the count.
DELETE FROM public.session_join_links;
INSERT INTO public.session_rsvps(session_id, account_id, status, family_squares_meeting_date, created_at) VALUES
  -- Weekly seat on: came last night.
  (public.family_squares_session_id(), '2b000000-0000-0000-0000-000000000001', 'going', '2026-11-16', '2026-11-10T18:00:00Z'),
  -- Weekly seat on: declined last night's meeting only.
  (public.family_squares_session_id(), '2b000000-0000-0000-0000-000000000006', 'declined', '2026-11-16', '2026-11-10T18:00:00Z'),
  -- No weekly seat: saved last night's seat.
  (public.family_squares_session_id(), '2b000000-0000-0000-0000-000000000005', 'going', '2026-11-16', '2026-11-10T18:00:00Z'),
  -- No weekly seat: already saved next Monday's.
  (public.family_squares_session_id(), '2b000000-0000-0000-0000-000000000002', 'going', '2026-11-23', '2026-11-17T05:00:00Z');

SELECT is(public.reset_family_squares_weekly_rsvps(), 3, 'the reset still reports the rows it cleared');
SELECT is((SELECT row(rsvps, declined)::text FROM public.family_squares_meeting_stats WHERE meeting_date = '2026-11-16'),
  row(2, 1)::text, 'last night''s RSVP counts were recorded before they were cleared');
SELECT is(ARRAY(SELECT right(account_id::text, 1) || ':' || status || ':' || family_squares_meeting_date FROM public.session_rsvps
  WHERE session_id = public.family_squares_session_id() ORDER BY 1),
  ARRAY['1:going:2026-11-23', '2:going:2026-11-23', '6:going:2026-11-23', '7:going:2026-11-23'],
  'next Monday: weekly seats saved again (a decline lasted one week), an early seat kept, a one-off seat cleared');

SELECT * FROM finish();
ROLLBACK;
