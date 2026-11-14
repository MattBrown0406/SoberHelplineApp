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
      'public.service_family_squares_hold_weekly_seat(uuid,date,text)']) AS f),
  'only the service role (the 15-minute sync) asks who needs a weekly seat and saves one');
SELECT ok(NOT has_function_privilege('anon', 'public._family_squares_coming_meeting_date(timestamptz)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._family_squares_coming_meeting_date(timestamptz)', 'EXECUTE'),
  'the date helper is internal');
SELECT ok(NOT has_table_privilege('anon', 'public.family_squares_weekly_seat_holds', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.family_squares_weekly_seat_holds', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.family_squares_weekly_seat_holds', 'INSERT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.family_squares_weekly_seat_holds'::regclass),
  'what the website answered is not readable or writable by clients');
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

-- ── Who the 15-minute sync asks the website about ───────────────────────────
-- The helpers only ever act on the coming meeting, read from the real clock.
CREATE TEMP TABLE coming AS SELECT public._family_squares_coming_meeting_date(now()) AS d;
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
-- B asked 40 days ago and has shown no sign of using the app since.
UPDATE public.accounts SET family_squares_weekly_seat_set_at = now() - interval '40 days', first_name = '  ', last_name = NULL
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

-- Signs of app use in the last 35 days.
UPDATE public.accounts SET push_token_seen_at = now() - interval '10 days' WHERE id = '2b000000-0000-0000-0000-000000000002';
SELECT is(pg_temp.candidates(), ARRAY['1', '2'], 'her device checked in ten days ago: B is asked about');
SELECT is((SELECT name FROM public.service_family_squares_weekly_seat_candidates((SELECT d FROM coming))
  WHERE account_id = '2b000000-0000-0000-0000-000000000002'), 'Family', 'no name on file: the name register falls back to');
UPDATE public.accounts SET push_token_seen_at = now() - interval '36 days' WHERE id = '2b000000-0000-0000-0000-000000000002';
SELECT is(pg_temp.candidates(), ARRAY['1'], '36 days ago is too long');
UPDATE auth.users SET last_sign_in_at = now() - interval '2 days' WHERE id = '1b000000-0000-0000-0000-000000000002';
SELECT is(pg_temp.candidates(), ARRAY['1', '2'], 'a recent sign-in counts');
UPDATE auth.users SET last_sign_in_at = NULL WHERE id = '1b000000-0000-0000-0000-000000000002';
INSERT INTO public.funnel_events(account_id, stage, metadata, created_at)
VALUES ('2b000000-0000-0000-0000-000000000002', 'attended', '{"source":"today"}', now() - interval '5 days');
SELECT is(pg_temp.candidates(), ARRAY['1', '2'], 'so does something she did in the app (a Join tap)');
DELETE FROM public.funnel_events WHERE account_id = '2b000000-0000-0000-0000-000000000002';
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
  '22023', 'invalid_hold', 'only the website''s two refusals are kept');
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
-- The website will not register A.
SELECT public.service_family_squares_hold_weekly_seat('2b000000-0000-0000-0000-000000000001', (SELECT d FROM coming), 'registration_unavailable');
SELECT is(pg_temp.candidates(), ARRAY[]::text[], 'a member the website refused is not asked about again for that meeting');
UPDATE public.family_squares_weekly_seat_holds SET noted_at = now() - interval '3 days';
SELECT is(pg_temp.candidates(), ARRAY[]::text[], 'however long ago it refused');
SELECT is((SELECT count(*)::integer FROM public.session_rsvps WHERE session_id = public.family_squares_session_id()
  AND account_id = '2b000000-0000-0000-0000-000000000001'), 0, 'and nothing was written for her');

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
