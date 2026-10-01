BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(21);

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role) VALUES
 ('65000000-0000-0000-0000-000000000001','vs-owner@example.com','{}','{}','authenticated','authenticated'),
 ('65000000-0000-0000-0000-000000000002','vs-coach@example.com','{}','{}','authenticated','authenticated'),
 ('65000000-0000-0000-0000-000000000003','vs-premier-en@example.com','{}','{}','authenticated','authenticated'),
 ('65000000-0000-0000-0000-000000000004','vs-premier-es@example.com','{}','{}','authenticated','authenticated'),
 ('65000000-0000-0000-0000-000000000005','vs-oneoff-en@example.com','{}','{}','authenticated','authenticated'),
 ('65000000-0000-0000-0000-000000000006','vs-oneoff-es@example.com','{}','{}','authenticated','authenticated'),
 ('65000000-0000-0000-0000-000000000007','vs-past@example.com','{}','{}','authenticated','authenticated');
UPDATE public.accounts SET id = ('66000000-0000-0000-0000-' || right(user_id::text, 12))::uuid, type = 'direct',
  timezone = 'America/Chicago', locale = 'en'
WHERE user_id::text LIKE '65000000-0000-0000-0000-0000000000%';
UPDATE public.accounts SET locale = 'es-MX' WHERE id IN ('66000000-0000-0000-0000-000000000004', '66000000-0000-0000-0000-000000000006');
INSERT INTO public.entitlements(account_id, source, tier, expires_at) VALUES
 ('66000000-0000-0000-0000-000000000003', 'scholarship', 'premium', now() + interval '30 days'),
 ('66000000-0000-0000-0000-000000000004', 'scholarship', 'premium', now() + interval '30 days'),
 ('66000000-0000-0000-0000-000000000005', 'scholarship', 'essential', now() + interval '30 days'),
 ('66000000-0000-0000-0000-000000000006', 'scholarship', 'essential', now() + interval '30 days'),
 ('66000000-0000-0000-0000-000000000007', 'scholarship', 'premium', now() + interval '30 days');
INSERT INTO public.video_staff_roles(account_id, role) VALUES
 ('66000000-0000-0000-0000-000000000001', 'owner'),
 ('66000000-0000-0000-0000-000000000002', 'coach');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SELECT request_private_video_session(now()+interval '5 days','America/Chicago',60,NULL);
SELECT set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
SELECT request_private_video_session(now()+interval '5 days 2 hours','America/Chicago',60,NULL);
SELECT set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
SELECT request_plan_review_video_session(now()+interval '24 hours','America/Chicago',60,'plan_review',NULL,'[]','{safetyPlan}'::text[],'{"schemaVersion":"1","sections":{"safetyPlan":{}}}'::jsonb,'I choose to share this plan. This is not an emergency service.','en','one_off_150');
SELECT set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000006","role":"authenticated"}',true);
SELECT request_plan_review_video_session(now()+interval '5 days 6 hours','America/Chicago',60,'plan_review',NULL,'[]','{safetyPlan}'::text[],'{"schemaVersion":"1","sections":{"safetyPlan":{}}}'::jsonb,'Comparto este plan. Esto no es un servicio de emergencia.','es','one_off_150');
SELECT set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000007","role":"authenticated"}',true);
SELECT request_private_video_session(now()+interval '5 days 8 hours','America/Chicago',60,NULL);
-- The owner records both one-off payments so they can be confirmed.
SELECT set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SELECT admin_mark_plan_review_paid(id, 'fixture payment') FROM video_sessions
WHERE account_id IN ('66000000-0000-0000-0000-000000000005', '66000000-0000-0000-0000-000000000006');
RESET ROLE;
DELETE FROM push_outbox WHERE account_id IN (SELECT id FROM accounts WHERE user_id::text LIKE '65000000-0000-0000-0000-0000000000%');

-- ── D1: accepting the coach's time keeps the member's timezone ──────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SELECT coach_counteroffer_video_session((SELECT id FROM video_sessions WHERE account_id = '66000000-0000-0000-0000-000000000003'), 1,
  now()+interval '6 days', 'America/New_York', 60, 'coach time', NULL);
SELECT set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SELECT lives_ok($$SELECT member_accept_video_proposal((SELECT id FROM video_sessions WHERE account_id = '66000000-0000-0000-0000-000000000003'),
  (SELECT p.id FROM video_session_proposals p JOIN video_sessions s ON s.id = p.session_id WHERE s.account_id = '66000000-0000-0000-0000-000000000003' AND p.status = 'pending' AND p.proposed_by_role = 'coach'), 2)$$,
  'the member accepts the coach''s proposal');
RESET ROLE;
SELECT is((SELECT requested_timezone FROM video_sessions WHERE account_id = '66000000-0000-0000-0000-000000000003'), 'America/Chicago',
  'accepting keeps the member''s own timezone, not the coach''s');
SELECT is((SELECT status FROM video_sessions WHERE account_id = '66000000-0000-0000-0000-000000000003'), 'scheduled', 'the accepted proposal is scheduled');
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE account_id = '66000000-0000-0000-0000-000000000002'
           AND kind = 'coach_video_accepted'), 1, 'the coach is told the proposal was accepted');

-- ── D2: past start times are rejected ──────────────────────────────────────
RESET ROLE;
UPDATE video_session_proposals SET status = 'superseded'
WHERE status = 'pending' AND session_id = (SELECT id FROM video_sessions WHERE account_id = '66000000-0000-0000-0000-000000000004');
INSERT INTO video_session_proposals(session_id, proposed_by_account_id, proposed_by_role, coach_id, starts_at, timezone, duration_minutes, note)
SELECT id, '66000000-0000-0000-0000-000000000002', 'coach', '66000000-0000-0000-0000-000000000002', now() - interval '1 hour', 'America/Chicago', 60, 'stale'
FROM video_sessions WHERE account_id = '66000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
SELECT throws_ok($$SELECT member_accept_video_proposal((SELECT id FROM video_sessions WHERE account_id = '66000000-0000-0000-0000-000000000004'),
  (SELECT p.id FROM video_session_proposals p JOIN video_sessions s ON s.id = p.session_id WHERE s.account_id = '66000000-0000-0000-0000-000000000004' AND p.status = 'pending' AND p.proposed_by_role = 'coach'), 1)$$,
  '22023', 'start_time_in_past', 'a proposal whose time has passed cannot be accepted');
RESET ROLE;
DELETE FROM video_session_proposals WHERE note = 'stale';
UPDATE video_sessions SET requested_start = now() - interval '10 minutes' WHERE account_id = '66000000-0000-0000-0000-000000000007';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SELECT throws_ok($$SELECT coach_confirm_video_session((SELECT id FROM video_sessions WHERE account_id = '66000000-0000-0000-0000-000000000007'), 1, NULL)$$,
  '22023', 'start_time_in_past', 'a request whose time has passed cannot be confirmed');
RESET ROLE;
SELECT is((SELECT status FROM video_sessions WHERE account_id = '66000000-0000-0000-0000-000000000007'), 'requested', 'the stale request is left for a counteroffer');

-- ── D3: localized, neutral member notifications ────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SELECT coach_confirm_video_session(s.id, s.version, NULL) FROM video_sessions s
WHERE s.account_id IN ('66000000-0000-0000-0000-000000000004', '66000000-0000-0000-0000-000000000005', '66000000-0000-0000-0000-000000000006');
RESET ROLE;
SELECT is((SELECT title FROM push_outbox WHERE account_id = '66000000-0000-0000-0000-000000000004' AND kind = 'member_video_scheduled'),
  'Sesión de video confirmada', 'a Spanish Premier member is told in Spanish');
SELECT matches((SELECT body FROM push_outbox WHERE account_id = '66000000-0000-0000-0000-000000000004' AND kind = 'member_video_scheduled'),
  '^Tu sesión de video Premier quedó confirmada para el \d{1,2}/\d{1,2} a las \d{1,2}:\d{2} \(America/Chicago\)\.$', 'the Spanish confirmation names the time in her zone');
SELECT is((SELECT title FROM push_outbox WHERE account_id = '66000000-0000-0000-0000-000000000005' AND kind = 'member_video_scheduled'),
  'Video session confirmed', 'an English one-off member is told in English');
SELECT ok((SELECT body LIKE 'Your video session is confirmed for %' AND body NOT LIKE '%Premier%'
           FROM push_outbox WHERE account_id = '66000000-0000-0000-0000-000000000005' AND kind = 'member_video_scheduled'),
  'a one-off plan review is not called Premier');
SELECT ok((SELECT body LIKE 'Tu sesión de video quedó confirmada%' FROM push_outbox
           WHERE account_id = '66000000-0000-0000-0000-000000000006' AND kind = 'member_video_scheduled'),
  'a Spanish one-off confirmation is neutral and in Spanish');
SELECT ok((SELECT bool_and(metadata->>'kind' = kind) FROM push_outbox
           WHERE account_id IN (SELECT id FROM accounts WHERE user_id::text LIKE '65000000-0000-0000-0000-0000000000%')),
  'every video push keeps its routing kind');

-- Reminders: the one-off session is exactly 24 hours out.
UPDATE video_sessions SET scheduled_for = now() + interval '24 hours' WHERE account_id = '66000000-0000-0000-0000-000000000006';
UPDATE video_sessions SET scheduled_for = now() + interval '30 days' WHERE account_id NOT IN ('66000000-0000-0000-0000-000000000005', '66000000-0000-0000-0000-000000000006') AND status = 'scheduled';
SELECT is(enqueue_premier_video_reminders(), 4, 'reminders go to both members and their coach');
SELECT is((SELECT title FROM push_outbox WHERE account_id = '66000000-0000-0000-0000-000000000005' AND kind = 'premier_video_reminder'),
  'Video session tomorrow', 'an English one-off reminder is neutral');
SELECT ok((SELECT body LIKE 'Your video session is tomorrow, %' FROM push_outbox WHERE account_id = '66000000-0000-0000-0000-000000000005' AND kind = 'premier_video_reminder'),
  'the English reminder body names the session plainly');
SELECT is((SELECT title FROM push_outbox WHERE account_id = '66000000-0000-0000-0000-000000000006' AND kind = 'premier_video_reminder'),
  'Tu sesión de video es mañana', 'a Spanish reminder is in Spanish');
SELECT ok((SELECT bool_and(title NOT LIKE '%Premier%') FROM push_outbox WHERE account_id = '66000000-0000-0000-0000-000000000002' AND kind = 'coach_video_reminder'),
  'the coach reminder for a one-off review is not called Premier');

-- Cancellation (member side and staff side).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SELECT coach_cancel_video_session(id, version, 'fixture') FROM video_sessions WHERE account_id = '66000000-0000-0000-0000-000000000006';
SELECT set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
SELECT member_cancel_video_session(id, version, NULL) FROM video_sessions WHERE account_id = '66000000-0000-0000-0000-000000000005';
RESET ROLE;
SELECT is((SELECT body FROM push_outbox WHERE account_id = '66000000-0000-0000-0000-000000000006' AND kind = 'member_video_cancelled'),
  'Tu sesión de video fue cancelada.', 'a Spanish cancellation is in Spanish and neutral');
SELECT is((SELECT body FROM push_outbox WHERE account_id = '66000000-0000-0000-0000-000000000002' AND kind = 'coach_video_cancelled'),
  'A member cancelled a video session.', 'staff copy for a one-off cancellation drops "Premier"');
SELECT ok(NOT has_function_privilege('authenticated', 'public._video_member_push_copy(text,text,boolean,boolean,text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public._video_push_when(timestamptz,text,boolean)', 'EXECUTE'),
  'push copy helpers are internal');

SELECT * FROM finish();
ROLLBACK;
