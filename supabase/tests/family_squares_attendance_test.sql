BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- ── Privileges ──────────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon', 'public.log_funnel_event(text,jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.log_funnel_event(text,jsonb)', 'EXECUTE'),
  'only signed-in members log funnel events');
SELECT ok(NOT has_function_privilege('anon', 'public._family_squares_rsvp_counts(date)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._family_squares_rsvp_counts(date)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._family_squares_record_meeting_stats(date)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._family_squares_record_meeting_stats(date)', 'EXECUTE'),
  'clients cannot call the counting helpers');
SELECT ok(NOT has_table_privilege('anon', 'public.family_squares_meeting_stats', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.family_squares_meeting_stats', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.family_squares_meeting_stats', 'INSERT'),
  'the counts table is not readable or writable by clients');
SELECT ok(NOT has_function_privilege('anon', 'public.admin_funnel_stats()', 'EXECUTE'), 'anon cannot read the admin figures');

-- ── Fixtures: Monday 2026-11-16, 7:30 PM Pacific (the meeting is on) ────────
-- The functions read the clock; pin it inside this rolled-back test only.
DO $$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef('public.log_funnel_event(text,jsonb)'::regprocedure) INTO definition;
  EXECUTE replace(definition, 'now()', '''2026-11-17T03:30:00Z''::timestamptz');
  SELECT pg_get_functiondef('public.admin_funnel_stats()'::regprocedure) INTO definition;
  EXECUTE replace(definition, 'now()', '''2026-11-17T03:30:00Z''::timestamptz');
END $$;

DELETE FROM public.session_rsvps;
DELETE FROM public.funnel_events;
DELETE FROM public.family_squares_meeting_stats;
INSERT INTO auth.users(id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role) VALUES
  ('1a000000-0000-0000-0000-000000000001', 'att-a@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1a000000-0000-0000-0000-000000000002', 'att-b@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1a000000-0000-0000-0000-000000000003', 'att-c@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1a000000-0000-0000-0000-000000000004', 'att-d@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1a000000-0000-0000-0000-000000000005', 'att-es@example.com', now(), '{}', '{}', 'authenticated', 'authenticated'),
  ('1a000000-0000-0000-0000-0000000000ff', 'matt@soberhelpline.com', now(), '{}', '{}', 'authenticated', 'authenticated')
ON CONFLICT (id) DO NOTHING;
UPDATE public.accounts SET id = ('2a000000-0000-0000-0000-00000000000' || right(user_id::text, 1))::uuid, locale = 'en'
WHERE user_id::text LIKE '1a000000-0000-0000-0000-00000000000_';
UPDATE public.accounts SET locale = 'es' WHERE id = '2a000000-0000-0000-0000-000000000005';

INSERT INTO public.session_rsvps(session_id, account_id, status, family_squares_meeting_date, created_at) VALUES
  (public.family_squares_session_id(), '2a000000-0000-0000-0000-000000000001', 'going', '2026-11-16', '2026-11-12T18:00:00Z'),
  (public.family_squares_session_id(), '2a000000-0000-0000-0000-000000000002', 'declined', '2026-11-16', '2026-11-12T18:00:00Z'),
  -- 4.1 writes no meeting date: saved during the week before the meeting.
  (public.family_squares_session_id(), '2a000000-0000-0000-0000-000000000003', 'going', NULL, '2026-11-14T18:00:00Z'),
  -- Already saved for the meeting after this one.
  (public.family_squares_session_id(), '2a000000-0000-0000-0000-000000000004', 'going', '2026-11-23', '2026-11-12T18:00:00Z'),
  -- A Spanish member's row for Family Squares: she joins La Sobremesa.
  (public.family_squares_session_id(), '2a000000-0000-0000-0000-000000000005', 'going', '2026-11-16', '2026-11-12T18:00:00Z');
-- The admin hosts: his own seat is not an RSVP to count.
INSERT INTO public.session_rsvps(session_id, account_id, status, family_squares_meeting_date, created_at)
SELECT public.family_squares_session_id(), a.id, 'going', '2026-11-16', '2026-11-12T18:00:00Z'
FROM public.accounts a WHERE a.user_id = '1a000000-0000-0000-0000-0000000000ff';

INSERT INTO public.funnel_events(account_id, stage, metadata, created_at) VALUES
  ('2a000000-0000-0000-0000-000000000001', 'attended', '{"source":"today"}', '2026-11-16 19:05 America/Los_Angeles'),
  ('2a000000-0000-0000-0000-000000000001', 'attended', '{"source":"support"}', '2026-11-16 19:20 America/Los_Angeles'),
  -- A Spanish member tapping Join is joining La Sobremesa.
  ('2a000000-0000-0000-0000-000000000005', 'attended', '{"source":"support"}', '2026-11-16 19:50 America/Los_Angeles'),
  -- Tapped Join in the middle of the week: not this meeting.
  ('2a000000-0000-0000-0000-000000000002', 'attended', '{"source":"today"}', '2026-11-13 10:00 America/Los_Angeles'),
  -- Opened the meeting early, at 5:30 PM Pacific: counted. At 4:30 PM: not.
  ('2a000000-0000-0000-0000-000000000004', 'attended', '{"source":"push"}', '2026-11-16 17:30 America/Los_Angeles'),
  ('2a000000-0000-0000-0000-000000000003', 'attended', '{"source":"today"}', '2026-11-16 16:30 America/Los_Angeles'),
  -- A Spanish member's ten minutes were at La Sobremesa.
  ('2a000000-0000-0000-0000-000000000005', 'attended_10min', '{"meeting_date":"2026-11-16","source":"support"}', '2026-11-16 20:05 America/Los_Angeles'),
  -- Last week's meeting.
  ('2a000000-0000-0000-0000-000000000003', 'attended', '{"source":"today"}', '2026-11-09 19:10 America/Los_Angeles'),
  ('2a000000-0000-0000-0000-000000000003', 'attended_10min', '{"meeting_date":"2026-11-09","source":"today"}', '2026-11-09 20:05 America/Los_Angeles');
INSERT INTO public.funnel_events(account_id, stage, metadata, created_at)
SELECT a.id, e.stage, e.metadata::jsonb, e.logged_at::timestamptz
FROM public.accounts a,
  (VALUES ('attended', '{"source":"today"}', '2026-11-16 19:01 America/Los_Angeles'),
          ('attended_10min', '{"meeting_date":"2026-11-16","source":"today"}', '2026-11-16 19:30 America/Los_Angeles')) AS e(stage, metadata, logged_at)
WHERE a.user_id = '1a000000-0000-0000-0000-0000000000ff';
INSERT INTO public.family_squares_meeting_stats(meeting_date, rsvps, declined) VALUES ('2026-11-09', 5, 1);

-- ── The counts for one meeting ──────────────────────────────────────────────
SELECT is((SELECT row(going, declined)::text FROM public._family_squares_rsvp_counts('2026-11-16')), row(2, 1)::text,
  'dated answers for that Monday plus undated (4.1) seats saved the week before it; not the admin''s or a Spanish member''s');
SELECT is((SELECT row(going, declined)::text FROM public._family_squares_rsvp_counts('2026-11-23')), row(1, 0)::text,
  'next week''s early seat counts for next week only');
SELECT lives_ok($$SELECT public._family_squares_record_meeting_stats('2026-11-16')$$, 'the reset can record a meeting''s counts');
UPDATE public.session_rsvps SET status = 'declined' WHERE account_id = '2a000000-0000-0000-0000-000000000003';
SELECT lives_ok($$SELECT public._family_squares_record_meeting_stats('2026-11-16')$$, 'recording twice is safe');
SELECT is((SELECT row(rsvps, declined)::text FROM public.family_squares_meeting_stats WHERE meeting_date = '2026-11-16'), row(2, 1)::text,
  'a second recording never replaces the first');
-- The reset run a second time in the same hour: the RSVPs are already cleared.
CREATE TEMP TABLE cleared AS SELECT * FROM public.session_rsvps WHERE session_id = public.family_squares_session_id();
DELETE FROM public.session_rsvps WHERE session_id = public.family_squares_session_id();
SELECT lives_ok($$SELECT public._family_squares_record_meeting_stats('2026-11-16')$$, 'recording after the RSVPs were cleared is safe');
SELECT is((SELECT row(rsvps, declined)::text FROM public.family_squares_meeting_stats WHERE meeting_date = '2026-11-16'), row(2, 1)::text,
  'and the counts are not replaced with zeros');
INSERT INTO public.session_rsvps SELECT * FROM cleared;
DELETE FROM public.family_squares_meeting_stats WHERE meeting_date = '2026-11-16';
UPDATE public.session_rsvps SET status = 'going' WHERE account_id = '2a000000-0000-0000-0000-000000000003';

-- ── attended_10min: the meeting date and the source, once per meeting ───────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"1a000000-0000-0000-0000-000000000001","email":"att-a@example.com","role":"authenticated"}', true);
SELECT lives_ok($$SELECT public.log_funnel_event('attended_10min', '{"meeting_date":"2026-11-16","source":"push","note":"private words"}')$$,
  'a member who stayed ten minutes is recorded');
SELECT lives_ok($$SELECT public.log_funnel_event('attended_10min', '{"meeting_date":"2026-11-16","source":"today"}')$$,
  'a second report for the same meeting is accepted quietly');
SELECT throws_ok($$SELECT public.log_funnel_event('attended_10min', '{"source":"today"}')$$, 'P0001', 'bad_meeting_date', 'a meeting date is required');
SELECT throws_ok($$SELECT public.log_funnel_event('attended_10min', '{"meeting_date":"2026-13-45"}')$$, 'P0001', 'bad_meeting_date', 'a date that is not a date is refused');
SELECT throws_ok($$SELECT public.log_funnel_event('attended_10min', '{"meeting_date":"2026-11-15"}')$$, 'P0001', 'bad_meeting_date', 'the meeting is on a Monday');
SELECT throws_ok($$SELECT public.log_funnel_event('attended_10min', '{"meeting_date":"2026-11-09"}')$$, 'P0001', 'bad_meeting_date', 'last week''s meeting cannot be reported now');
SELECT throws_ok($$SELECT public.log_funnel_event('attended_10min', '{"meeting_date":"2026-11-23"}')$$, 'P0001', 'bad_meeting_date', 'next week''s meeting cannot be reported yet');
SELECT set_config('request.jwt.claims', '{"sub":"1a000000-0000-0000-0000-000000000002","email":"att-b@example.com","role":"authenticated"}', true);
SELECT lives_ok($$SELECT public.log_funnel_event('attended_10min', '{"meeting_date":"2026-11-16","source":"somewhere else"}')$$,
  'an unknown source is recorded as unknown');
SELECT lives_ok($$SELECT public.log_funnel_event('attended', '{"source":"push"}')$$, 'a Join tap is still logged as before');
SELECT throws_ok($$SELECT public.log_funnel_event('attended_an_hour', '{}')$$, 'P0001', 'bad_stage', 'unknown stages are still refused');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT is((SELECT count(*)::integer FROM public.funnel_events WHERE stage = 'attended_10min' AND account_id = '2a000000-0000-0000-0000-000000000001'), 1,
  'once per member and meeting');
SELECT is((SELECT metadata::text FROM public.funnel_events WHERE stage = 'attended_10min' AND account_id = '2a000000-0000-0000-0000-000000000001'),
  '{"source": "push", "meeting_date": "2026-11-16"}', 'only the meeting date and the source are kept');
SELECT is((SELECT metadata ->> 'source' FROM public.funnel_events WHERE stage = 'attended_10min' AND account_id = '2a000000-0000-0000-0000-000000000002'),
  'unknown', 'sources outside the list are not stored as sent');
-- B's Join tap above was logged at the real clock, not the pinned one: move it out of the way.
DELETE FROM public.funnel_events WHERE stage = 'attended' AND account_id = '2a000000-0000-0000-0000-000000000002' AND metadata ->> 'source' = 'push';

-- ── The admin figure ────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"1a000000-0000-0000-0000-000000000001","email":"att-a@example.com","role":"authenticated"}', true);
SELECT throws_ok($$SELECT public.admin_funnel_stats()$$, 'P0001', 'not authorized', 'members cannot read the admin figures');
SELECT set_config('request.jwt.claims', '{"sub":"1a000000-0000-0000-0000-0000000000ff","email":"matt@soberhelpline.com","role":"authenticated"}', true);
-- Kept in a setting: the admin's own role creates nothing in the database.
SELECT set_config('test.funnel_stats', public.admin_funnel_stats()::text, true);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
CREATE TEMP TABLE stats AS SELECT current_setting('test.funnel_stats')::jsonb AS s;

SELECT ok((SELECT s ?& ARRAY['members', 'paid_accounts', 'onboarded_loved_one', 'free_rsvps', 'attended',
    'coaching_requested', 'coaching_confirmed', 'intervention_viewed', 'intervention_started', 'bands'] FROM stats),
  'every key older admin builds read is still there');
SELECT is((SELECT jsonb_array_length(s -> 'family_squares_weeks') FROM stats), 4, 'the coming meeting and the three before it');
SELECT is((SELECT s -> 'family_squares_weeks' -> 0 FROM stats),
  '{"meeting_date":"2026-11-16","rsvps":2,"declined":1,"join_taps":2,"attended_10min":2}'::jsonb,
  'tonight''s meeting: all four figures count the same members, never the admin or a Spanish member; an early Join tap counts');
SELECT is((SELECT s -> 'family_squares_weeks' -> 1 FROM stats),
  '{"meeting_date":"2026-11-09","rsvps":5,"declined":1,"join_taps":1,"attended_10min":1}'::jsonb,
  'last week: the RSVP counts recorded before the reset cleared them');
SELECT is((SELECT (s -> 'family_squares_weeks' -> 2) - 'meeting_date' FROM stats),
  '{"rsvps":null,"declined":null,"join_taps":0,"attended_10min":0}'::jsonb,
  'a meeting from before counts were kept shows no RSVP number rather than a false zero');

SELECT * FROM finish();
ROLLBACK;
