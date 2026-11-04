BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(46);

-- ── Which call is "this week's" ───────────────────────────────────────────
SELECT is(public._family_squares_latest_meeting_date('2026-11-09 18:59 America/Los_Angeles'), date '2026-11-02',
  'before Monday''s call starts, the latest call is last week''s');
SELECT is(public._family_squares_latest_meeting_date('2026-11-09 19:00 America/Los_Angeles'), date '2026-11-09',
  'once it starts, it is tonight''s');
SELECT is(public._family_squares_latest_meeting_date('2026-11-15 23:00 America/Los_Angeles'), date '2026-11-09',
  'Sunday still points at Monday''s call');
SELECT is(public._family_squares_week_monday('2026-11-09 08:00 America/Los_Angeles'), date '2026-11-09',
  'an admin writing Monday morning writes for tonight''s call');

-- Fixed calls in 2025, so the run date (the live "latest call") never collides.
-- ── Accounts (fixed ids; RLS hides subqueries from authenticated) ─────────
INSERT INTO auth.users(id, email, raw_app_meta_data, raw_user_meta_data, aud, role, email_confirmed_at) VALUES
  ('16000000-0000-0000-0000-000000000001', 'fu-a@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('16000000-0000-0000-0000-000000000002', 'fu-b@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('16000000-0000-0000-0000-000000000003', 'fu-c@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('16000000-0000-0000-0000-000000000004', 'fu-d@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('16000000-0000-0000-0000-000000000005', 'fu-e@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('16000000-0000-0000-0000-000000000006', 'fu-f@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('16000000-0000-0000-0000-000000000007', 'fu-g@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('16000000-0000-0000-0000-0000000000ff', 'matt@soberhelpline.com', '{}', '{}', 'authenticated', 'authenticated', now())
ON CONFLICT (id) DO NOTHING;
UPDATE public.accounts SET id = ('26000000-0000-0000-0000-00000000000' || right(user_id::text, 1))::uuid
WHERE user_id::text LIKE '16000000-0000-0000-0000-00000000000_';
UPDATE public.accounts SET push_token = 'ExponentPushToken[fu-' || right(id::text, 1) || ']',
  family_call_reminders = true, locale = 'en', timezone = 'America/New_York'
WHERE id::text LIKE '26000000-0000-0000-0000-00000000000_';
UPDATE public.accounts SET timezone = 'Europe/London' WHERE id = '26000000-0000-0000-0000-000000000002';
UPDATE public.accounts SET locale = 'es' WHERE id = '26000000-0000-0000-0000-000000000003';
UPDATE public.accounts SET family_call_reminders = false WHERE id = '26000000-0000-0000-0000-000000000004';
UPDATE public.accounts SET push_token = NULL WHERE id = '26000000-0000-0000-0000-000000000005';
UPDATE public.accounts SET push_token = 'ExponentPushToken[fu-admin]'
WHERE user_id = '16000000-0000-0000-0000-0000000000ff';

-- Seats for Monday 2025-11-10: A dated, B undated (4.1) during the week, C/D/E
-- excluded by language, switch and device; G only has next week's seat; F
-- tapped Join during the call without a seat.
INSERT INTO public.session_rsvps(account_id, session_id, status, family_squares_meeting_date, created_at) VALUES
  ('26000000-0000-0000-0000-000000000001', public.family_squares_session_id(), 'going', '2025-11-10', '2025-11-06 10:00 America/Los_Angeles'),
  ('26000000-0000-0000-0000-000000000002', public.family_squares_session_id(), 'going', NULL, '2025-11-09 12:00 America/Los_Angeles'),
  ('26000000-0000-0000-0000-000000000003', public.family_squares_session_id(), 'going', '2025-11-10', '2025-11-06 10:00 America/Los_Angeles'),
  ('26000000-0000-0000-0000-000000000004', public.family_squares_session_id(), 'going', '2025-11-10', '2025-11-06 10:00 America/Los_Angeles'),
  ('26000000-0000-0000-0000-000000000005', public.family_squares_session_id(), 'going', '2025-11-10', '2025-11-06 10:00 America/Los_Angeles'),
  ('26000000-0000-0000-0000-000000000007', public.family_squares_session_id(), 'going', '2025-11-17', '2025-11-10 20:30 America/Los_Angeles')
ON CONFLICT DO NOTHING;
INSERT INTO public.funnel_events(account_id, stage, metadata, created_at)
VALUES ('26000000-0000-0000-0000-000000000006', 'attended', '{"source":"today"}', '2025-11-10 19:20 America/Los_Angeles');

-- ── Takeaway: admins write it, members read the latest call's ─────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"16000000-0000-0000-0000-000000000001","email":"fu-a@example.com","role":"authenticated"}', true);
SELECT throws_ok($$SELECT public.admin_set_family_call_takeaway('x')$$, 'P0001', 'not authorized', 'members cannot write the takeaway');
SELECT throws_ok($$SELECT public.admin_get_family_call_takeaway()$$, 'P0001', 'not authorized', 'members cannot read the admin view');
SELECT ok(NOT has_table_privilege('authenticated', 'public.family_call_takeaways', 'SELECT'), 'the table itself is not readable');
SELECT set_config('request.jwt.claims', '{"sub":"16000000-0000-0000-0000-0000000000ff","email":"matt@soberhelpline.com","role":"authenticated"}', true);
SELECT throws_ok($$SELECT public.admin_set_family_call_takeaway(repeat('x', 151))$$, '22023', 'takeaway_too_long', 'at most 150 characters: the Tuesday note quotes it whole');
SELECT is(public.admin_set_family_call_takeaway('  Hold   one limit for seven days.  ') ->> 'body', 'Hold one limit for seven days.',
  'saved trimmed, inner spaces collapsed');
SELECT is(public.admin_set_family_call_takeaway('') ->> 'body', NULL, 'an empty line clears it');
RESET ROLE;
INSERT INTO public.family_call_takeaways(meeting_date, body) VALUES (public._family_squares_latest_meeting_date(now()), 'Say one true sentence to one person.');
INSERT INTO public.family_call_takeaways(meeting_date, body) VALUES ('2025-11-10', 'Hold one limit for seven days.')
ON CONFLICT (meeting_date) DO UPDATE SET body = EXCLUDED.body;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"16000000-0000-0000-0000-000000000001","email":"fu-a@example.com","role":"authenticated"}', true);
SELECT is(public.family_call_takeaway() ->> 'body', 'Say one true sentence to one person.', 'members read the latest call''s one thing');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT is((SELECT public.family_call_takeaway()), NULL::jsonb, 'nobody signed in: nothing');

-- ── Tuesday follow-up ─────────────────────────────────────────────────────
SELECT is(public.enqueue_family_call_followups('2025-11-11 02:10 America/Los_Angeles'), 0, 'the 2 AM run (after the reset) does nothing');
SELECT is(public.enqueue_family_call_followups('2025-11-10 01:10 America/Los_Angeles'), 0, 'Monday 1 AM does nothing');
SELECT is(public.enqueue_family_call_followups('2025-11-11 01:10 America/Los_Angeles'), 3, 'Tuesday 1 AM Pacific enqueues three notes');
SELECT is(public.enqueue_family_call_followups('2025-11-11 01:40 America/Los_Angeles'), 0, 'one per member per call');
SELECT set_eq(
  $$SELECT account_id FROM push_outbox WHERE kind = 'family_call_followup'$$,
  $$VALUES ('26000000-0000-0000-0000-000000000001'::uuid), ('26000000-0000-0000-0000-000000000002'::uuid), ('26000000-0000-0000-0000-000000000006'::uuid)$$,
  'a seat (dated or 4.1-undated) or a Join tap during the call; not Spanish, switched off, deviceless or next-week-only');
SELECT is((SELECT scheduled_for FROM push_outbox WHERE kind = 'family_call_followup' AND account_id = '26000000-0000-0000-0000-000000000001'),
  '2025-11-11 10:30 America/New_York'::timestamptz, 'New York gets it at 10:30 AM her time, clear of the morning note');
SELECT is((SELECT scheduled_for FROM push_outbox WHERE kind = 'family_call_followup' AND account_id = '26000000-0000-0000-0000-000000000002'),
  '2025-11-11 10:30 Europe/London'::timestamptz, 'London (9:10 AM there) also waits for 10:30');
SELECT is((SELECT expires_at FROM push_outbox WHERE kind = 'family_call_followup' AND account_id = '26000000-0000-0000-0000-000000000001'),
  '2025-11-11 21:00 America/New_York'::timestamptz, 'never shown after 9 PM her time');
SELECT is((SELECT body FROM push_outbox WHERE kind = 'family_call_followup' AND account_id = '26000000-0000-0000-0000-000000000001'),
  'This week''s one thing: Hold one limit for seven days.', 'quotes Matt''s line for that call');
SELECT is((SELECT metadata FROM push_outbox WHERE kind = 'family_call_followup' AND account_id = '26000000-0000-0000-0000-000000000001'),
  '{"kind":"family_call_followup","meeting_date":"2025-11-10"}'::jsonb, 'the routed payload');
SELECT ok(NOT has_function_privilege('authenticated', 'public.enqueue_family_call_followups(timestamptz)', 'EXECUTE'),
  'members cannot enqueue');

-- No line written: the wording depends on what her app build can show.
UPDATE public.accounts SET push_app_contract = 1 WHERE id = '26000000-0000-0000-0000-000000000001';
UPDATE public.session_rsvps SET family_squares_meeting_date = '2025-11-17'
WHERE account_id = '26000000-0000-0000-0000-000000000001' AND session_id = public.family_squares_session_id();
SELECT is(public.enqueue_family_call_followups('2025-11-18 01:10 America/Los_Angeles'), 2, 'next week: A (seat moved) and G');
SELECT is((SELECT body FROM push_outbox WHERE idempotency_key = 'family-call-followup:2025-11-17:26000000-0000-0000-0000-000000000001'),
  'Your one thing to try this week is on Today, and next Monday''s seat is one tap away.', '4.2 (3)+: points at Today''s card');
SELECT is((SELECT body FROM push_outbox WHERE idempotency_key = 'family-call-followup:2025-11-17:26000000-0000-0000-0000-000000000007'),
  'Next Monday''s call is free too. You can save your seat in the app.', 'older builds: nothing they cannot find');

-- Registering a device records which build it is.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"16000000-0000-0000-0000-000000000007","email":"fu-g@example.com","role":"authenticated"}', true);
SELECT ok(public.register_push_device('ExponentPushToken[fu-g-new]', 'en', 1), 'a 4.2 (3) build registers with its contract');
RESET ROLE;
SELECT is((SELECT push_app_contract FROM accounts WHERE id = '26000000-0000-0000-0000-000000000007'), 1::smallint, 'stored');
SET LOCAL ROLE authenticated;
SELECT ok(public.register_push_device('ExponentPushToken[fu-g-old]', 'en'), 'an older build registers the old way');
RESET ROLE;
SELECT is((SELECT push_app_contract FROM accounts WHERE id = '26000000-0000-0000-0000-000000000007'), NULL::smallint,
  'and its token belongs to a build without the new pushes');

-- Delivery re-checks her daytime at send time.
CREATE TEMP TABLE zones AS SELECT
  (SELECT name FROM pg_timezone_names WHERE name LIKE 'Etc/GMT%' AND (now() AT TIME ZONE name)::time BETWEEN '10:00' AND '18:00' ORDER BY name LIMIT 1) AS day_tz,
  (SELECT name FROM pg_timezone_names WHERE name LIKE 'Etc/GMT%' AND (now() AT TIME ZONE name)::time BETWEEN '01:00' AND '05:00' ORDER BY name LIMIT 1) AS night_tz;
UPDATE public.accounts SET timezone = (SELECT day_tz FROM zones) WHERE id = '26000000-0000-0000-0000-000000000001';
UPDATE public.accounts SET timezone = (SELECT night_tz FROM zones) WHERE id = '26000000-0000-0000-0000-000000000006';
INSERT INTO push_outbox(account_id, kind, title, body, metadata, idempotency_key, scheduled_for, expires_at, processing_at, processing_token)
VALUES
  ('26000000-0000-0000-0000-000000000001', 'family_call_followup', 't', 'b', '{"kind":"family_call_followup"}', 'fu-test-day',
   now() - interval '1 minute', now() + interval '6 hours', now(), 'dd700000-0000-0000-0000-000000000001'),
  ('26000000-0000-0000-0000-000000000006', 'family_call_followup', 't', 'b', '{"kind":"family_call_followup"}', 'fu-test-night',
   now() - interval '1 minute', now() + interval '6 hours', now(), 'dd700000-0000-0000-0000-000000000001');
SELECT is((SELECT dispatcher_outbox_delivery(id, 'dd700000-0000-0000-0000-000000000001') ->> 'push_token' FROM push_outbox WHERE idempotency_key = 'fu-test-day'),
  'ExponentPushToken[fu-1]', 'delivered in her daytime');
SELECT is((SELECT dispatcher_outbox_delivery(id, 'dd700000-0000-0000-0000-000000000001') FROM push_outbox WHERE idempotency_key = 'fu-test-night'),
  NULL::jsonb, 'never in her night');
UPDATE public.accounts SET family_call_reminders = false WHERE id = '26000000-0000-0000-0000-000000000001';
SELECT is((SELECT dispatcher_outbox_delivery(id, 'dd700000-0000-0000-0000-000000000001') FROM push_outbox WHERE idempotency_key = 'fu-test-day'),
  NULL::jsonb, 'switching Monday reminders off withdraws it');

-- ── Questions are screened; a crisis question alerts admins ───────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"16000000-0000-0000-0000-000000000002","email":"fu-b@example.com","role":"authenticated"}', true);
INSERT INTO public.session_questions(id, account_id, session_id, question, crisis_tier) VALUES
  ('36000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000002', public.family_squares_session_id(),
   'How do I stop paying his phone bill without a fight?', 'firm');
INSERT INTO public.session_questions(id, account_id, session_id, question) VALUES
  ('36000000-0000-0000-0000-000000000002', '26000000-0000-0000-0000-000000000002', public.family_squares_session_id(),
   'He took a bunch of pills and is not waking up, what do I do');
SELECT is((SELECT crisis_tier FROM public.session_questions WHERE id = '36000000-0000-0000-0000-000000000001'), NULL,
  'an ordinary question is not flagged, whatever the client sends');
SELECT isnt((SELECT crisis_tier FROM public.session_questions WHERE id = '36000000-0000-0000-0000-000000000002'), NULL,
  'an overdose question is flagged and the member can read the flag');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM push_outbox WHERE kind = 'admin_session_question'), 1, 'one admin alert');
SELECT is((SELECT metadata ->> 'question_id' FROM push_outbox WHERE kind = 'admin_session_question'),
  '36000000-0000-0000-0000-000000000002', 'the alert names the question');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"16000000-0000-0000-0000-0000000000ff","email":"matt@soberhelpline.com","role":"authenticated"}', true);
SELECT isnt((SELECT crisis_tier FROM public.admin_get_session_questions() WHERE id = '36000000-0000-0000-0000-000000000002'), NULL,
  'the admin list marks it');
RESET ROLE;
-- 4.1 lets a member ask for La Sobremesa too: a crisis one must be findable.
INSERT INTO public.session_questions(id, account_id, session_id, question) VALUES
  ('36000000-0000-0000-0000-000000000003', '26000000-0000-0000-0000-000000000003', public.la_sobremesa_session_id(),
   'Mi hijo tomó muchas pastillas y no despierta'),
  ('36000000-0000-0000-0000-000000000004', '26000000-0000-0000-0000-000000000003', public.la_sobremesa_session_id(),
   '¿Cómo pongo un límite con el dinero?');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"16000000-0000-0000-0000-0000000000ff","email":"matt@soberhelpline.com","role":"authenticated"}', true);
SELECT is((SELECT session_title FROM public.admin_get_session_questions() WHERE id = '36000000-0000-0000-0000-000000000003'),
  'La Sobremesa', 'a crisis question for another call is in the list, titled');
SELECT is((SELECT count(*)::int FROM public.admin_get_session_questions() WHERE id = '36000000-0000-0000-0000-000000000004'), 0,
  'an ordinary one for another call is not');
RESET ROLE;

-- Winback ("We're still here") skips members who just got the Tuesday note.
UPDATE public.accounts SET daily_push_opt_in = true, created_at = now() - interval '30 days', last_winback_at = NULL,
  timezone = (SELECT day_tz FROM zones), family_call_reminders = true
WHERE id = '26000000-0000-0000-0000-000000000002';
INSERT INTO push_outbox(account_id, kind, title, body, metadata, idempotency_key, scheduled_for, expires_at)
VALUES ('26000000-0000-0000-0000-000000000002', 'family_call_followup', 't', 'b', '{"kind":"family_call_followup"}', 'fu-test-winback',
  now(), now() + interval '6 hours');
SELECT is(public.dispatcher_job_delivery('winback', '26000000-0000-0000-0000-000000000002', NULL, now() + interval '1 day', now(), false),
  NULL::jsonb, 'no winback the day of her Tuesday note');
DELETE FROM push_outbox WHERE account_id = '26000000-0000-0000-0000-000000000002' AND kind = 'family_call_followup';
SELECT isnt(public.dispatcher_job_delivery('winback', '26000000-0000-0000-0000-000000000002', NULL, now() + interval '1 day', now(), false),
  NULL::jsonb, 'otherwise winback is unchanged');

-- ── Tool usage: names only, once a day ────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"16000000-0000-0000-0000-000000000002","email":"fu-b@example.com","role":"authenticated"}', true);
SELECT public.log_funnel_event('tool_opened', '{"tool":"letter","draft":"private words"}');
SELECT public.log_funnel_event('tool_opened', '{"tool":"letter"}');
SELECT throws_ok($$SELECT public.log_funnel_event('tool_opened', '{"tool":"somewhere"}')$$, 'P0001', 'bad_tool', 'unknown tools are refused');
SELECT lives_ok($$SELECT public.log_funnel_event('tool_finished', '{"tool":"holiday_plan"}')$$, 'the Holiday Plan is an allowlisted tool');
SELECT lives_ok($$SELECT public.log_funnel_event('tool_finished', '{"tool":"prosecutor_letter"}')$$, 'the prosecutor letter is an allowlisted tool');
RESET ROLE;
SELECT is((SELECT array_agg(metadata) FROM funnel_events WHERE account_id = '26000000-0000-0000-0000-000000000002' AND stage = 'tool_opened'),
  ARRAY['{"tool":"letter"}'::jsonb], 'one event a day, holding only the tool name');

SELECT * FROM finish();
ROLLBACK;
