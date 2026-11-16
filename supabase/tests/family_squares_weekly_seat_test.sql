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
SELECT hasnt_function('public', '_family_squares_restore_weekly_seats', ARRAY['date'],
  'seats are no longer saved in SQL, where the website cannot be asked');
SELECT ok((SELECT bool_and(NOT has_function_privilege('anon', f, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', f, 'EXECUTE')
      AND has_function_privilege('service_role', f, 'EXECUTE'))
    FROM unnest(ARRAY['public.service_family_squares_weekly_seat_candidates(date)',
      'public.service_family_squares_save_weekly_seat(uuid,date)',
      'public.service_family_squares_hold_weekly_seat(uuid,date,text)',
      'public.service_family_squares_note_meeting_status(date,boolean,boolean)',
      'public.service_family_squares_announce_cancelled(date)',
      'public.service_family_squares_coming_meeting_cancelled()']) AS f),
  'only the service role (the 15-minute sync and the push senders) asks who needs a weekly seat, saves one, keeps what the website said, or tells seat holders a Monday is off');
SELECT ok(NOT has_function_privilege('anon', 'public._family_squares_coming_meeting_date(timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._family_squares_coming_meeting_date(timestamptz)', 'EXECUTE'),
  'the date helper is internal');
SELECT ok(NOT has_function_privilege('anon', 'public._family_squares_weekly_seat_members(date)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._family_squares_weekly_seat_members(date)', 'EXECUTE'),
  'so is the list of members waiting for a weekly seat');
SELECT hasnt_function('public', 'service_family_squares_note_meeting_status', ARRAY['date', 'boolean'],
  'the status is kept by one function, with the one-member flag');
SELECT ok(NOT has_table_privilege('anon', 'public.family_squares_weekly_seat_holds', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.family_squares_weekly_seat_holds', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.family_squares_weekly_seat_holds', 'INSERT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.family_squares_weekly_seat_holds'::regclass),
  'what the website answered is not readable or writable by clients');
SELECT ok(NOT has_table_privilege('anon', 'public.family_squares_meeting_status', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.family_squares_meeting_status', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.family_squares_meeting_status', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.family_squares_meeting_status', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.family_squares_meeting_status', 'DELETE')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.family_squares_meeting_status'::regclass),
  'whether a Monday is cancelled is written by the service role only, and never read from the table by clients');
SELECT ok(NOT has_function_privilege('anon', 'public.family_squares_meeting_cancelled(date)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.family_squares_meeting_cancelled(date)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.family_squares_meeting_cancelled(date)', 'EXECUTE'),
  'a signed-in member (the app) and the service role can ask whether a Monday is cancelled; a visitor cannot');
SELECT ok(NOT has_function_privilege('anon', 'public.reset_family_squares_weekly_rsvps()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.reset_family_squares_weekly_rsvps()', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.reset_family_squares_weekly_rsvps()', 'EXECUTE'),
  'the weekly reset stays service-role only');
-- (Reading it back as herself is checked below; members can read every
-- accounts column, so a SELECT privilege check here would prove nothing.)
SELECT ok(NOT has_column_privilege('authenticated', 'public.accounts', 'family_squares_weekly_seat', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.accounts', 'family_squares_weekly_seat_set_at', 'UPDATE'),
  'the preference, and when it was set, are changed only through the function');

-- ── Fixtures ────────────────────────────────────────────────────────────────
DELETE FROM public.session_rsvps;
DELETE FROM public.family_squares_meeting_stats;
DELETE FROM public.family_squares_weekly_seat_holds;
DELETE FROM public.family_squares_meeting_status;
-- The helpers only ever act on the coming meeting, read from the real clock.
CREATE TEMP TABLE coming AS SELECT public._family_squares_coming_meeting_date(now()) AS d;
INSERT INTO auth.users(id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role) VALUES
  ('1b000000-0000-0000-0000-000000000001', 'seat-a@example.com', now(), '{}', '{"first_name":"Ana"}', 'authenticated', 'authenticated'),
  ('1b000000-0000-0000-0000-000000000002', 'seat-b@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1b000000-0000-0000-0000-000000000003', 'seat-unverified@example.com', NULL, '{}', '{}', 'authenticated', 'authenticated'),
  ('1b000000-0000-0000-0000-000000000004', 'seat-es@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1b000000-0000-0000-0000-000000000005', 'seat-off@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1b000000-0000-0000-0000-000000000006', 'seat-declined@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1b000000-0000-0000-0000-000000000007', 'seat-early@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1b000000-0000-0000-0000-000000000008', 'seat-grieving@example.com', now(), '{}', '{}', 'authenticated', 'authenticated')
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
SELECT ok((SELECT family_squares_weekly_seat_set_at > now() - interval '1 minute' FROM public.accounts WHERE user_id = auth.uid()),
  'when she asked is kept: asking is a sign she uses the app');
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
  (public.family_squares_session_id(), '2b000000-0000-0000-0000-000000000001', 'going', (SELECT d FROM coming), now() - interval '2 hours'),
  (public.family_squares_session_id(), '2b000000-0000-0000-0000-000000000002', 'going', (SELECT d FROM coming), now() - interval '2 hours'),
  -- G's row is still last week's meeting's (what a row looks like between
  -- Monday 8 PM and the Tuesday 2 AM reset). C saved a seat on 4.1, which
  -- writes no meeting date, before last week's meeting ended; D did the same
  -- after it ended, so hers is for the coming meeting.
  (public.family_squares_session_id(), '2b000000-0000-0000-0000-000000000007', 'going', (SELECT d FROM coming) - 7, now() - interval '2 hours'),
  (public.family_squares_session_id(), '2b000000-0000-0000-0000-000000000003', 'going', NULL,
    (((SELECT d FROM coming) - 7) + time '19:30') AT TIME ZONE 'America/Los_Angeles'),
  (public.family_squares_session_id(), '2b000000-0000-0000-0000-000000000004', 'going', NULL,
    (((SELECT d FROM coming) - 7) + time '20:01') AT TIME ZONE 'America/Los_Angeles');
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
-- Only a seat for the coming meeting can be declined.
SELECT set_config('request.jwt.claims', '{"sub":"1b000000-0000-0000-0000-000000000007","email":"seat-early@example.com","role":"authenticated"}', true);
SELECT is(public.decline_family_squares_rsvp(), false,
  'a tap from a stale screen does not decline the meeting that already happened');
SELECT set_config('request.jwt.claims', '{"sub":"1b000000-0000-0000-0000-000000000003","email":"seat-unverified@example.com","role":"authenticated"}', true);
SELECT is(public.decline_family_squares_rsvp(), false,
  'nor an undated (4.1) seat saved before that meeting ended');
SELECT set_config('request.jwt.claims', '{"sub":"1b000000-0000-0000-0000-000000000004","email":"seat-es@example.com","role":"authenticated"}', true);
SELECT is(public.decline_family_squares_rsvp(), true,
  'an undated seat saved after it ended is for the coming meeting, and can be declined');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT is(ARRAY(SELECT right(account_id::text, 1) || ':' || status FROM public.session_rsvps
    WHERE session_id = public.family_squares_session_id()
      AND account_id IN ('2b000000-0000-0000-0000-000000000003', '2b000000-0000-0000-0000-000000000004', '2b000000-0000-0000-0000-000000000007')
    ORDER BY 1),
  ARRAY['3:going', '4:declined', '7:going'],
  'last week''s rows are left exactly as they were for the Tuesday note and the recorded counts');
DELETE FROM public.session_rsvps WHERE session_id = public.family_squares_session_id()
  AND account_id IN ('2b000000-0000-0000-0000-000000000003', '2b000000-0000-0000-0000-000000000004', '2b000000-0000-0000-0000-000000000007');

SELECT is((SELECT row(status, family_squares_meeting_date)::text FROM public.session_rsvps
  WHERE session_id = public.family_squares_session_id() AND account_id = '2b000000-0000-0000-0000-000000000001'),
  row('declined', (SELECT d FROM coming))::text, 'her RSVP is declined for the same meeting');
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

-- ── Who the 15-minute sync asks the website about ───────────────────────────
CREATE FUNCTION pg_temp.candidates() RETURNS text[] LANGUAGE sql AS $$
  SELECT ARRAY(SELECT right(c.account_id::text, 1)
    FROM public.service_family_squares_weekly_seat_candidates((SELECT d FROM coming)) c ORDER BY 1)
$$;
SELECT is(public._family_squares_coming_meeting_date('2026-11-16 19:59 America/Los_Angeles'), date '2026-11-16',
  'the coming meeting is tonight''s until it ends');
SELECT is(public._family_squares_coming_meeting_date('2026-11-16 20:00 America/Los_Angeles'), date '2026-11-23',
  'then next Monday''s');
SELECT is(public._family_squares_coming_meeting_date('2026-11-17 02:15 America/Los_Angeles'), date '2026-11-23',
  'as it is after the Tuesday reset');

DELETE FROM public.session_rsvps;
-- Everyone but E asked for a weekly seat just now.
UPDATE public.accounts SET family_squares_weekly_seat = true, family_squares_weekly_seat_set_at = now()
WHERE id::text LIKE '2b000000-%' AND id <> '2b000000-0000-0000-0000-000000000005';
UPDATE public.accounts SET last_name = 'Lopez' WHERE id = '2b000000-0000-0000-0000-000000000001';
-- B asked 200 days ago and has shown no sign of using the app since.
UPDATE public.accounts SET family_squares_weekly_seat_set_at = now() - interval '200 days', first_name = '  ', last_name = NULL
WHERE id = '2b000000-0000-0000-0000-000000000002';
-- H paused reminders and notes while she grieves.
INSERT INTO public.loved_ones(account_id, died_at, bereavement_quiet) VALUES ('2b000000-0000-0000-0000-000000000008', now(), true);
-- F said she can't make the coming meeting; G saved its seat herself.
INSERT INTO public.session_rsvps(session_id, account_id, status, family_squares_meeting_date, created_at) VALUES
  (public.family_squares_session_id(), '2b000000-0000-0000-0000-000000000006', 'declined', (SELECT d FROM coming), now() - interval '3 hours'),
  (public.family_squares_session_id(), '2b000000-0000-0000-0000-000000000007', 'going', (SELECT d FROM coming), now() - interval '3 hours');

SELECT is(pg_temp.candidates(), ARRAY['1'],
  'only A: not inactive (B), unverified (C), Spanish (D), not-asked (E), declined (F), already-saved (G) or grieving-quiet (H)');
SELECT is((SELECT row(email, name)::text FROM public.service_family_squares_weekly_seat_candidates((SELECT d FROM coming))),
  row('seat-a@example.com', 'Ana Lopez')::text, 'with the email and name family-squares-register would send');
SELECT is((SELECT count(*)::integer FROM public.service_family_squares_weekly_seat_candidates((SELECT d FROM coming) + 7)), 0,
  'never for a later meeting');
SELECT is((SELECT count(*)::integer FROM public.service_family_squares_weekly_seat_candidates((SELECT d FROM coming) - 7)), 0,
  'or an earlier one');
SELECT is((SELECT count(*)::integer FROM public.service_family_squares_weekly_seat_candidates(NULL)), 0, 'or no meeting at all');

-- Signs of app use in the last 180 days.
UPDATE public.accounts SET push_token_seen_at = now() - interval '10 days' WHERE id = '2b000000-0000-0000-0000-000000000002';
SELECT is(pg_temp.candidates(), ARRAY['1', '2'], 'her device checked in ten days ago: B is asked about');
SELECT is((SELECT name FROM public.service_family_squares_weekly_seat_candidates((SELECT d FROM coming))
  WHERE account_id = '2b000000-0000-0000-0000-000000000002'), 'Family', 'no name on file: the name register falls back to');
-- A regular who keeps notifications off and joins every Monday from the
-- website's reminder email: the app has not seen her for weeks.
UPDATE public.accounts SET push_token_seen_at = NULL, family_squares_weekly_seat_set_at = now() - interval '36 days'
WHERE id = '2b000000-0000-0000-0000-000000000002';
SELECT is(pg_temp.candidates(), ARRAY['1', '2'], 'five weeks without opening the app does not cost her the weekly seat');
UPDATE public.accounts SET family_squares_weekly_seat_set_at = now() - interval '179 days' WHERE id = '2b000000-0000-0000-0000-000000000002';
SELECT is(pg_temp.candidates(), ARRAY['1', '2'], 'nor does just under 180 days');
UPDATE public.accounts SET family_squares_weekly_seat_set_at = now() - interval '200 days' WHERE id = '2b000000-0000-0000-0000-000000000002';
SELECT is(pg_temp.candidates(), ARRAY['1'], 'asked 200 days ago and not seen since: no longer asked about');
UPDATE public.accounts SET push_token_seen_at = now() - interval '181 days' WHERE id = '2b000000-0000-0000-0000-000000000002';
SELECT is(pg_temp.candidates(), ARRAY['1'], '181 days ago is too long');
UPDATE auth.users SET last_sign_in_at = now() - interval '2 days' WHERE id = '1b000000-0000-0000-0000-000000000002';
SELECT is(pg_temp.candidates(), ARRAY['1', '2'], 'a recent sign-in counts');
UPDATE auth.users SET last_sign_in_at = NULL WHERE id = '1b000000-0000-0000-0000-000000000002';
INSERT INTO public.funnel_events(account_id, stage, metadata, created_at)
VALUES ('2b000000-0000-0000-0000-000000000002', 'attended', '{"source":"today"}', now() - interval '5 days');
SELECT is(pg_temp.candidates(), ARRAY['1', '2'], 'so does something she did in the app (a Join tap)');
DELETE FROM public.funnel_events WHERE account_id = '2b000000-0000-0000-0000-000000000002';
INSERT INTO public.checkins(account_id, mood, created_at)
VALUES ('2b000000-0000-0000-0000-000000000002', 3, now() - interval '181 days');
SELECT is(pg_temp.candidates(), ARRAY['1'], 'a daily check-in 181 days ago is too long ago');
UPDATE public.checkins SET created_at = now() - interval '4 days' WHERE account_id = '2b000000-0000-0000-0000-000000000002';
SELECT is(pg_temp.candidates(), ARRAY['1', '2'], 'her latest daily check-in counts as using the app');
DELETE FROM public.checkins WHERE account_id = '2b000000-0000-0000-0000-000000000002';
SELECT is(pg_temp.candidates(), ARRAY['1'], 'with no sign of her, her seat is not saved for ever');

-- The same people family-squares-register accepts.
UPDATE auth.users SET is_anonymous = true WHERE id = '1b000000-0000-0000-0000-000000000001';
SELECT is(pg_temp.candidates(), ARRAY[]::text[], 'not an anonymous sign-in');
UPDATE auth.users SET is_anonymous = false, deleted_at = now() WHERE id = '1b000000-0000-0000-0000-000000000001';
SELECT is(pg_temp.candidates(), ARRAY[]::text[], 'not a deleted one');
UPDATE auth.users SET deleted_at = NULL WHERE id = '1b000000-0000-0000-0000-000000000001';
-- Bereaved, but she did not ask for quiet: her seat is still saved.
UPDATE public.loved_ones SET bereavement_quiet = false WHERE account_id = '2b000000-0000-0000-0000-000000000008';
SELECT is(pg_temp.candidates(), ARRAY['1', '8'], 'only the pause she asked for stops her weekly seat');
UPDATE public.loved_ones SET bereavement_quiet = true WHERE account_id = '2b000000-0000-0000-0000-000000000008';

-- ── What the website answered ───────────────────────────────────────────────
SELECT throws_ok($$SELECT public.service_family_squares_hold_weekly_seat('2b000000-0000-0000-0000-000000000001', current_date, 'because')$$,
  '22023', 'invalid_hold', 'only the three answers the sync understands are kept');
SELECT throws_ok($$INSERT INTO public.family_squares_weekly_seat_holds(account_id, meeting_date, reason)
  VALUES ('2b000000-0000-0000-0000-000000000005', current_date, 'because')$$, '23514', NULL, 'the table refuses any other reason too');
INSERT INTO public.family_squares_weekly_seat_holds(account_id, meeting_date, reason)
VALUES ('2b000000-0000-0000-0000-000000000005', (SELECT d FROM coming) - 35, 'meeting_cancelled');
-- A cancelled Monday (the website said so when asked about G).
SELECT lives_ok($$SELECT public.service_family_squares_hold_weekly_seat('2b000000-0000-0000-0000-000000000007', (SELECT d FROM coming), 'meeting_cancelled')$$,
  'a cancelled Monday is noted');
SELECT is(pg_temp.candidates(), ARRAY[]::text[], 'cancelled: nobody is asked about, so no seat and no "your seat is saved" reminder');
SELECT is((SELECT count(*)::integer FROM public.family_squares_weekly_seat_holds WHERE meeting_date < (SELECT d FROM coming) - 28), 0,
  'answers about meetings long past are removed');
UPDATE public.family_squares_weekly_seat_holds SET noted_at = now() - interval '7 hours';
SELECT is(pg_temp.candidates(), ARRAY['1'], 'six hours later the website is asked again, in case the meeting is back on');

-- The website turned down the question about A alone (a 4xx reply the app
-- does not know).
SELECT lives_ok($$SELECT public.service_family_squares_hold_weekly_seat('2b000000-0000-0000-0000-000000000001', (SELECT d FROM coming), 'no_answer')$$,
  'no usable answer for one member is remembered');
SELECT is(pg_temp.candidates(), ARRAY[]::text[], 'she is not asked about again every 15 minutes');
SELECT is((SELECT count(*)::integer FROM public.session_rsvps WHERE session_id = public.family_squares_session_id()
  AND account_id = '2b000000-0000-0000-0000-000000000001'), 0, 'and nothing was written for her');
-- B shows a sign of app use again: someone else's hold never stops her.
UPDATE public.accounts SET push_token_seen_at = now() WHERE id = '2b000000-0000-0000-0000-000000000002';
SELECT is(pg_temp.candidates(), ARRAY['2'], 'the others are still asked about');
UPDATE public.accounts SET push_token_seen_at = now() - interval '181 days' WHERE id = '2b000000-0000-0000-0000-000000000002';
UPDATE public.family_squares_weekly_seat_holds SET noted_at = now() - interval '5 hours 50 minutes'
WHERE account_id = '2b000000-0000-0000-0000-000000000001';
SELECT is(pg_temp.candidates(), ARRAY[]::text[], 'still left alone just under six hours later');
UPDATE public.family_squares_weekly_seat_holds SET noted_at = now() - interval '6 hours 10 minutes'
WHERE account_id = '2b000000-0000-0000-0000-000000000001';
SELECT is(pg_temp.candidates(), ARRAY['1'], 'after six hours the website is asked about her again');

-- The website will not register A.
SELECT public.service_family_squares_hold_weekly_seat('2b000000-0000-0000-0000-000000000001', (SELECT d FROM coming), 'registration_unavailable');
SELECT is(pg_temp.candidates(), ARRAY[]::text[], 'a member the website refused is not asked about again for that meeting');
UPDATE public.family_squares_weekly_seat_holds SET noted_at = now() - interval '3 days';
SELECT is(pg_temp.candidates(), ARRAY[]::text[], 'however long ago it refused');
SELECT is((SELECT count(*)::integer FROM public.session_rsvps WHERE session_id = public.family_squares_session_id()
  AND account_id = '2b000000-0000-0000-0000-000000000001'), 0, 'and nothing was written for her');

-- ── A cancelled Monday, as the website's sync reply tells it ────────────────
DELETE FROM public.family_squares_weekly_seat_holds;
SELECT is(pg_temp.candidates(), ARRAY['1'], 'before the website says anything, A is asked about');
SELECT is(public.family_squares_meeting_cancelled((SELECT d FROM coming)), false, 'no row: the meeting is on');
SELECT is(public.family_squares_meeting_cancelled(NULL), false, 'no date: not cancelled');
SELECT is(public.service_family_squares_coming_meeting_cancelled(), false, 'and so is the coming one, asked without a date');
SELECT throws_ok($$SELECT public.service_family_squares_note_meeting_status(NULL, true)$$, '22023', 'invalid_meeting_status', 'a status needs a date');
SELECT throws_ok($$SELECT public.service_family_squares_note_meeting_status((SELECT d FROM coming), NULL)$$, '22023', 'invalid_meeting_status', 'and an answer');
SELECT throws_ok($$SELECT public.service_family_squares_note_meeting_status((SELECT d FROM coming) + 7, true)$$, '22023', 'invalid_meeting_status',
  'only the coming meeting, or the one that just ended');
SELECT throws_ok($$SELECT public.service_family_squares_note_meeting_status((SELECT d FROM coming) - 1, true)$$, '22023', 'invalid_meeting_status',
  'never a day that is not a meeting');
INSERT INTO public.family_squares_meeting_status(meeting_date, cancelled) VALUES ((SELECT d FROM coming) - 63, true);

SELECT lives_ok($$SELECT public.service_family_squares_note_meeting_status((SELECT d FROM coming), true)$$, 'the website says the coming Monday is cancelled');
SELECT is(public.family_squares_meeting_cancelled((SELECT d FROM coming)), true, 'the app and the pushes are told');
SELECT is(public.service_family_squares_coming_meeting_cancelled(), true, 'the Edge Functions too');
SELECT is(public.family_squares_meeting_cancelled((SELECT d FROM coming) - 7), false, 'only that Monday');
SELECT is(public.family_squares_meeting_cancelled((SELECT d FROM coming) + 7), false, 'not the one after');
SELECT is((SELECT count(*)::integer FROM public.family_squares_meeting_status WHERE meeting_date < (SELECT d FROM coming) - 56), 0,
  'answers about meetings long past are removed');
SELECT is(pg_temp.candidates(), ARRAY[]::text[], 'cancelled: no weekly seat is asked about, without calling the website');

-- "Cancelled" is believed only while it is fresh. The sync repeats the
-- website's answer every 15 minutes; an answer about the coming Monday that
-- is more than six hours old means the sync has stopped.
UPDATE public.family_squares_meeting_status SET noted_at = now() - interval '5 hours 50 minutes' WHERE meeting_date = (SELECT d FROM coming);
SELECT is(public.family_squares_meeting_cancelled((SELECT d FROM coming)), true, 'just under six hours old: still cancelled');
SELECT is(public.service_family_squares_coming_meeting_cancelled(), true, 'for the Edge Functions too');
SELECT is(pg_temp.candidates(), ARRAY[]::text[], 'and still no weekly seat is asked about');
UPDATE public.family_squares_meeting_status SET noted_at = now() - interval '6 hours 10 minutes' WHERE meeting_date = (SELECT d FROM coming);
SELECT is(public.family_squares_meeting_cancelled((SELECT d FROM coming)), false,
  'more than six hours old: nobody knows any more, and that is "not cancelled"');
SELECT is(public.service_family_squares_coming_meeting_cancelled(), false, 'so the morning note and the 15-minute reminder go out again');
SELECT is(pg_temp.candidates(), ARRAY['1'], 'and weekly seats are asked about again (the website still decides for each member)');
SELECT is((SELECT cancelled FROM public.family_squares_meeting_status WHERE meeting_date = (SELECT d FROM coming)), true,
  'the stored row is untouched; it is only no longer believed');
UPDATE public.family_squares_meeting_status SET noted_at = now() - interval '3 days' WHERE meeting_date = (SELECT d FROM coming);
SELECT is(public.family_squares_meeting_cancelled((SELECT d FROM coming)), false, 'a "cancelled" from days ago never silences the coming meeting');
-- The sync works again and the website still says cancelled.
SELECT lives_ok($$SELECT public.service_family_squares_note_meeting_status((SELECT d FROM coming), true)$$, 'the next sync says cancelled again');
SELECT is(public.family_squares_meeting_cancelled((SELECT d FROM coming)), true, 'a fresh answer is believed at once');
SELECT is(pg_temp.candidates(), ARRAY[]::text[], 'and weekly seats stop again');

-- A meeting that has ended (last Monday's): the sync has moved on to the
-- coming one, so the last answer for that date is never fresh again. It
-- stands if it was written on the day of the meeting or later; Tuesday's
-- 1 AM follow-up asks about last night this way.
SELECT lives_ok($$SELECT public.service_family_squares_note_meeting_status((SELECT d FROM coming) - 7, true)$$,
  'an answer that arrives just after a meeting ended is still kept for that meeting');
SELECT is(public.family_squares_meeting_cancelled((SELECT d FROM coming) - 7), true, 'and is believed for it');
UPDATE public.family_squares_meeting_status
SET noted_at = (((SELECT d FROM coming) - 7) + time '19:45') AT TIME ZONE 'America/Los_Angeles'
WHERE meeting_date = (SELECT d FROM coming) - 7;
SELECT is(public.family_squares_meeting_cancelled((SELECT d FROM coming) - 7), true,
  'the last sync before it ended still stands hours and days later, however old it is now');
UPDATE public.family_squares_meeting_status
SET noted_at = (((SELECT d FROM coming) - 7) + time '00:00') AT TIME ZONE 'America/Los_Angeles'
WHERE meeting_date = (SELECT d FROM coming) - 7;
SELECT is(public.family_squares_meeting_cancelled((SELECT d FROM coming) - 7), true, 'written on the morning of the meeting day: stands');
UPDATE public.family_squares_meeting_status
SET noted_at = ((((SELECT d FROM coming) - 7) + time '00:00') AT TIME ZONE 'America/Los_Angeles') - interval '1 minute'
WHERE meeting_date = (SELECT d FROM coming) - 7;
SELECT is(public.family_squares_meeting_cancelled((SELECT d FROM coming) - 7), false,
  'written before the meeting day and never repeated: the sync had stopped, so it is not believed');
SELECT is(public.family_squares_meeting_cancelled((SELECT d FROM coming)), true, 'none of which changes the coming Monday');
SELECT is((SELECT count(*)::integer FROM public.family_squares_meeting_status WHERE meeting_date = (SELECT d FROM coming)), 1, 'one row per Monday');

-- A member (the app) reads the answer through the function, never from the
-- table, and cannot write it.
SELECT set_config('test.coming', (SELECT d::text FROM coming), true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"1b000000-0000-0000-0000-000000000001","email":"seat-a@example.com","role":"authenticated"}', true);
SELECT is(public.family_squares_meeting_cancelled(current_setting('test.coming')::date), true, 'a member can ask whether the coming Monday is cancelled');
SELECT is(public.family_squares_meeting_cancelled(current_setting('test.coming')::date + 7), false, 'and gets "not cancelled" for a Monday nobody has said anything about');
SELECT throws_ok($$SELECT * FROM public.family_squares_meeting_status$$, '42501', NULL, 'she cannot read the table');
SELECT throws_ok($$SELECT public.service_family_squares_note_meeting_status(current_setting('test.coming')::date, false)$$, '42501', NULL,
  'or put a cancelled meeting back on herself');
SELECT throws_ok($$SELECT public.service_family_squares_coming_meeting_cancelled()$$, '42501', NULL, 'the Edge Functions'' own question is not hers to ask');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- The meeting is put back on.
SELECT public.service_family_squares_hold_weekly_seat('2b000000-0000-0000-0000-000000000007', (SELECT d FROM coming), 'meeting_cancelled');
SELECT public.service_family_squares_hold_weekly_seat('2b000000-0000-0000-0000-000000000006', (SELECT d FROM coming), 'registration_unavailable');
SELECT lives_ok($$SELECT public.service_family_squares_note_meeting_status((SELECT d FROM coming), false)$$, 'the website says the meeting is on again');
SELECT is(public.family_squares_meeting_cancelled((SELECT d FROM coming)), false, 'it is announced again');
SELECT is(ARRAY(SELECT reason FROM public.family_squares_weekly_seat_holds WHERE meeting_date = (SELECT d FROM coming) ORDER BY 1),
  ARRAY['registration_unavailable'], 'an earlier "cancelled" answer about one member no longer stands; a refusal does');
SELECT is(pg_temp.candidates(), ARRAY['1'], 'and weekly seats are asked about again at once');

-- One member's "cancelled" (family-squares-register passes p_one_member) does
-- not replace what the sync's own reply said in the last 30 minutes.
SELECT lives_ok($$SELECT public.service_family_squares_note_meeting_status((SELECT d FROM coming), true, true)$$,
  'the website tells one member the Monday is cancelled, just after its sync reply said it is on');
SELECT is((SELECT cancelled FROM public.family_squares_meeting_status WHERE meeting_date = (SELECT d FROM coming)), false,
  'the sync reply is the authority: the status is left as it is');
SELECT is(public.family_squares_meeting_cancelled((SELECT d FROM coming)), false, 'the reminders go on');
SELECT is(pg_temp.candidates(), ARRAY['1'], 'and so do weekly seats');
UPDATE public.family_squares_meeting_status SET noted_at = now() - interval '29 minutes' WHERE meeting_date = (SELECT d FROM coming);
SELECT lives_ok($$SELECT public.service_family_squares_note_meeting_status((SELECT d FROM coming), true, true)$$, 'again, 29 minutes after the sync said "on"');
SELECT is((SELECT row(cancelled, noted_at < now() - interval '28 minutes')::text FROM public.family_squares_meeting_status
  WHERE meeting_date = (SELECT d FROM coming)), row(false, true)::text, 'still on, and the row was not touched');
UPDATE public.family_squares_meeting_status SET noted_at = now() - interval '31 minutes' WHERE meeting_date = (SELECT d FROM coming);
SELECT lives_ok($$SELECT public.service_family_squares_note_meeting_status((SELECT d FROM coming), true, true)$$,
  'the sync has not said "on" for more than two runs');
SELECT is(public.family_squares_meeting_cancelled((SELECT d FROM coming)), true, 'her answer is kept, as it always was');
-- The sync's own reply always replaces the status, fresh or not.
SELECT lives_ok($$SELECT public.service_family_squares_note_meeting_status((SELECT d FROM coming), false)$$, 'the sync says "on"');
SELECT lives_ok($$SELECT public.service_family_squares_note_meeting_status((SELECT d FROM coming), true)$$, 'and, a run later, "cancelled"');
SELECT is(public.family_squares_meeting_cancelled((SELECT d FROM coming)), true, 'the sync reply is believed at once');
SELECT lives_ok($$SELECT public.service_family_squares_note_meeting_status((SELECT d FROM coming), true, true)$$, 'one member hears the same');
SELECT is(public.family_squares_meeting_cancelled((SELECT d FROM coming)), true, 'still cancelled');
-- Nothing stored at all: one member's answer is kept.
DELETE FROM public.family_squares_meeting_status WHERE meeting_date = (SELECT d FROM coming);
SELECT lives_ok($$SELECT public.service_family_squares_note_meeting_status((SELECT d FROM coming), true, true)$$, 'the website has said nothing yet');
SELECT is(public.family_squares_meeting_cancelled((SELECT d FROM coming)), true, 'her answer is kept');
SELECT throws_ok($$SELECT public.service_family_squares_note_meeting_status((SELECT d FROM coming) + 7, true, true)$$, '22023', 'invalid_meeting_status',
  'and the date is checked as before');
SELECT lives_ok($$SELECT public.service_family_squares_note_meeting_status((SELECT d FROM coming), false)$$, 'the meeting is on again for what follows');
DELETE FROM public.family_squares_weekly_seat_holds;
SELECT public.service_family_squares_hold_weekly_seat('2b000000-0000-0000-0000-000000000001', (SELECT d FROM coming), 'registration_unavailable');

-- ── Saving the seat, once the website has said yes ──────────────────────────
SELECT is(public.service_family_squares_save_weekly_seat('2b000000-0000-0000-0000-000000000001', (SELECT d FROM coming) + 7), false,
  'never for a meeting other than the coming one');
SELECT is(public.service_family_squares_save_weekly_seat('2b000000-0000-0000-0000-000000000001', NULL), false, 'or for no meeting');
SELECT is(public.service_family_squares_save_weekly_seat('2b000000-0000-0000-0000-000000000001', (SELECT d FROM coming)), true,
  'A''s seat is saved');
SELECT is((SELECT row(status, family_squares_meeting_date)::text FROM public.session_rsvps
  WHERE session_id = public.family_squares_session_id() AND account_id = '2b000000-0000-0000-0000-000000000001'),
  row('going', (SELECT d FROM coming))::text, 'going, and dated like a seat she saved herself');
SELECT is((SELECT count(*)::integer FROM public.family_squares_weekly_seat_holds WHERE account_id = '2b000000-0000-0000-0000-000000000001'), 0,
  'the website said yes: its earlier refusal no longer holds');
SELECT is(public.service_family_squares_save_weekly_seat('2b000000-0000-0000-0000-000000000001', (SELECT d FROM coming)), false,
  'saving again writes nothing');
SELECT is(public.service_family_squares_save_weekly_seat('2b000000-0000-0000-0000-000000000006', (SELECT d FROM coming)), false,
  'a member who declined this week is not given a seat');
SELECT is(public.service_family_squares_save_weekly_seat('2b000000-0000-0000-0000-000000000005', (SELECT d FROM coming)), false,
  'nor a member who turned the weekly seat off meanwhile');
SELECT is(ARRAY(SELECT right(account_id::text, 1) || ':' || status FROM public.session_rsvps
  WHERE session_id = public.family_squares_session_id() ORDER BY 1),
  ARRAY['1:going', '6:declined', '7:going'], 'her decline stands, and nobody else got a row');
SELECT is(pg_temp.candidates(), ARRAY[]::text[], 'with her seat saved, A is not asked about again');
SELECT is((SELECT row(name, rsvp)::text FROM public.service_family_squares_attendees(now() - interval '1 day') WHERE email = 'seat-a@example.com'),
  row('Ana', 'going')::text, 'the website sync carries the saved seat like any RSVP');
SELECT ok(pg_temp.call('session_reminder', '2b000000-0000-0000-0000-000000000001', '2026-10-06T01:05:00Z') IS NOT NULL,
  'the hour-before reminder treats the saved seat like any RSVP');
SELECT is(pg_temp.call('family_call_30min', '2b000000-0000-0000-0000-000000000001', '2026-10-06T01:32:00Z'), NULL,
  'and she is not also sent the invite for people without a seat');

-- ── The whole Tuesday reset ─────────────────────────────────────────────────
-- Force the real reset definition's clock inside this rolled-back test only.
CREATE TEMP TABLE reset_def AS
  SELECT pg_get_functiondef('public.reset_family_squares_weekly_rsvps()'::regprocedure) AS def;
CREATE FUNCTION pg_temp.pin_reset(p_at text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE replace((SELECT def FROM reset_def), 'clock_timestamp()', quote_literal(p_at) || '::timestamptz');
END;
$$;
CREATE FUNCTION pg_temp.last_night() RETURNS void LANGUAGE sql AS $$
  DELETE FROM public.session_rsvps;
  INSERT INTO public.session_rsvps(session_id, account_id, status, family_squares_meeting_date, created_at) VALUES
    -- Weekly seat on: came last night.
    (public.family_squares_session_id(), '2b000000-0000-0000-0000-000000000001', 'going', '2026-11-16', '2026-11-10T18:00:00Z'),
    -- Weekly seat on: declined last night's meeting only.
    (public.family_squares_session_id(), '2b000000-0000-0000-0000-000000000006', 'declined', '2026-11-16', '2026-11-10T18:00:00Z'),
    -- No weekly seat: saved last night's seat.
    (public.family_squares_session_id(), '2b000000-0000-0000-0000-000000000005', 'going', '2026-11-16', '2026-11-10T18:00:00Z'),
    -- Already saved next Monday's.
    (public.family_squares_session_id(), '2b000000-0000-0000-0000-000000000002', 'going', '2026-11-23', '2026-11-17T05:00:00Z');
$$;
-- La Sobremesa links are cleared by the same reset: keep them out of the count.
DELETE FROM public.session_join_links;
DELETE FROM public.family_squares_meeting_stats;

-- Outside the acting hour (Tuesday 3 AM, and Monday 2 AM, Pacific) nothing happens.
SELECT pg_temp.last_night();
SELECT pg_temp.pin_reset('2026-11-17T11:00:00Z');
SELECT is(public.reset_family_squares_weekly_rsvps(), 0, 'Tuesday 3 AM Pacific: the reset does nothing');
SELECT pg_temp.pin_reset('2026-11-16T10:00:00Z');
SELECT is(public.reset_family_squares_weekly_rsvps(), 0, 'Monday 2 AM Pacific: nothing either');
SELECT is((SELECT count(*)::integer FROM public.session_rsvps WHERE session_id = public.family_squares_session_id()), 4,
  'no RSVP was cleared');
SELECT is((SELECT count(*)::integer FROM public.family_squares_meeting_stats), 0, 'and no counts were recorded');

-- Tuesday 2026-11-17, 2:00 AM Pacific, after Monday 2026-11-16's meeting.
SELECT pg_temp.pin_reset('2026-11-17T10:00:00Z');
SELECT is(public.reset_family_squares_weekly_rsvps(), 3, 'the reset still reports the rows it cleared');
SELECT is((SELECT row(rsvps, declined)::text FROM public.family_squares_meeting_stats WHERE meeting_date = '2026-11-16'),
  row(2, 1)::text, 'last night''s RSVP counts were recorded before they were cleared');
SELECT is(ARRAY(SELECT right(account_id::text, 1) || ':' || status || ':' || family_squares_meeting_date FROM public.session_rsvps
  WHERE session_id = public.family_squares_session_id() ORDER BY 1),
  ARRAY['2:going:2026-11-23'],
  'an early seat for next Monday is kept; the reset itself saves no weekly seat (the sync does, once the website agrees)');
SELECT is(public.reset_family_squares_weekly_rsvps(), 0, 'run again in the same hour, it clears nothing more');
SELECT is((SELECT row(rsvps, declined)::text FROM public.family_squares_meeting_stats WHERE meeting_date = '2026-11-16'),
  row(2, 1)::text, 'and last night''s counts are not replaced with zeros');

-- Counting fails: the reset still clears.
DELETE FROM public.family_squares_meeting_stats;
SELECT pg_temp.last_night();
CREATE OR REPLACE FUNCTION public._family_squares_record_meeting_stats(p_meeting_date date)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'counting is broken';
END;
$$;
SELECT is(public.reset_family_squares_weekly_rsvps(), 3, 'a failure while recording the counts does not stop the reset');
SELECT is(ARRAY(SELECT right(account_id::text, 1) FROM public.session_rsvps
  WHERE session_id = public.family_squares_session_id() ORDER BY 1), ARRAY['2'], 'last night''s RSVPs are cleared all the same');
SELECT is((SELECT count(*)::integer FROM public.family_squares_meeting_stats), 0, 'only the counts are missing');

SELECT * FROM finish();
ROLLBACK;
