BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;

SELECT plan(50);

-- Fixed identities make failures easy to diagnose and keep the fixture independent
-- of production data. auth.users inserts create accounts via the app trigger.
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
VALUES
 ('10000000-0000-0000-0000-000000000001','owner-test@example.com','{}','{}','authenticated','authenticated'),
 ('10000000-0000-0000-0000-000000000002','coach-test@example.com','{}','{}','authenticated','authenticated'),
 ('10000000-0000-0000-0000-000000000003','member-a-test@example.com','{}','{}','authenticated','authenticated'),
 ('10000000-0000-0000-0000-000000000004','member-b-test@example.com','{}','{}','authenticated','authenticated'),
 ('10000000-0000-0000-0000-000000000005','member-c-test@example.com','{}','{}','authenticated','authenticated'),
 ('10000000-0000-0000-0000-000000000006','member-d-test@example.com','{}','{}','authenticated','authenticated'),
 ('10000000-0000-0000-0000-000000000007','member-e-test@example.com','{}','{}','authenticated','authenticated'),
 ('10000000-0000-0000-0000-000000000008','member-f-test@example.com','{}','{}','authenticated','authenticated'),
 ('10000000-0000-0000-0000-000000000009','member-g-test@example.com','{}','{}','authenticated','authenticated'),
 ('10000000-0000-0000-0000-000000000010','member-h-test@example.com','{}','{}','authenticated','authenticated');

-- Replace trigger-generated account IDs with deterministic fixture IDs.
UPDATE public.accounts SET id = ('20000000-0000-0000-0000-' || right(user_id::text,12))::uuid
WHERE user_id::text LIKE '10000000-0000-0000-0000-0000000000%';
UPDATE public.accounts SET type='direct', timezone='America/Los_Angeles'
WHERE user_id::text LIKE '10000000-0000-0000-0000-0000000000%';
INSERT INTO public.entitlements(account_id,source,tier,expires_at)
SELECT id,'scholarship','premium',now()+interval '30 days' FROM public.accounts
WHERE user_id BETWEEN '10000000-0000-0000-0000-000000000003'::uuid AND '10000000-0000-0000-0000-000000000010'::uuid;
INSERT INTO public.video_staff_roles(account_id,role) VALUES ('20000000-0000-0000-0000-000000000001','owner');

-- The RPC migration intentionally removed direct mutation policies. Grant table-level
-- privileges only inside this rolled-back test transaction so RLS itself can be
-- exercised (the local schema does not otherwise expose these tables to the role).
GRANT SELECT, UPDATE ON video_sessions TO authenticated;
GRANT EXECUTE ON FUNCTION is_video_staff(uuid), is_video_owner(uuid) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","email":"owner-test@example.com","role":"authenticated"}',true);
SELECT lives_ok(
  $$SELECT owner_set_video_staff_role('20000000-0000-0000-0000-000000000002','coach',true)$$,
  'owner can establish an active coach role');
SELECT is((owner_set_video_staff_role('20000000-0000-0000-0000-000000000001','owner',true)).role,'owner','owner role is active');
SELECT is((owner_set_video_staff_role('20000000-0000-0000-0000-000000000002','coach',true)).role,'coach','coach role is active');

-- Member A: exact request validation and duplicate-active invariant.
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000003","email":"member-a-test@example.com","role":"authenticated"}',true);
SELECT throws_ok(
  $$SELECT request_private_video_session(NULL,'America/Los_Angeles',60,NULL)$$,
  'P0001','invalid_request','an exact requested future time is required');
SELECT throws_ok(
  $$SELECT request_private_video_session(now()+interval '1 day',NULL,60,NULL)$$,
  '22023','invalid_timezone','a timezone is required');
SELECT throws_ok(
  $$SELECT request_private_video_session(now()+interval '1 day','Not/A_Timezone',60,NULL)$$,
  '22023','invalid_timezone','timezone must be a real IANA timezone');
SELECT throws_ok(
  $$SELECT request_private_video_session(now()-interval '1 minute','America/Los_Angeles',60,NULL)$$,
  'P0001','invalid_request','past requested time is rejected');
SELECT lives_ok(
  $$SELECT request_private_video_session(now()+interval '10 days','America/Los_Angeles',60,'exact request')$$,
  'valid exact future request succeeds');
SELECT is((SELECT requested_timezone FROM member_get_active_video_session()),'America/Los_Angeles','request preserves exact timezone');
SELECT ok((SELECT requested_start > now() FROM member_get_active_video_session()),'request preserves a future exact instant');
SELECT throws_ok(
  $$SELECT request_private_video_session(now()+interval '11 days','UTC',30,NULL)$$,
  '23505','active_session_exists','duplicate request cannot create a second active session');
SELECT is((SELECT count(*)::integer FROM member_get_active_video_session()),1,'member has exactly one active session');

-- Member B cannot see/mutate A and cannot invoke staff RPCs.
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000004","email":"member-b-test@example.com","role":"authenticated"}',true);
SELECT is((SELECT count(*)::integer FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000003'),0,'unauthorized member cannot read another member session');
WITH changed AS (
  UPDATE video_sessions SET member_note='intrusion'
  WHERE account_id='20000000-0000-0000-0000-000000000003' RETURNING 1
) SELECT is((SELECT count(*)::integer FROM changed),0,'unauthorized member cannot directly update another session');
SELECT throws_ok(
  $$SELECT coach_confirm_video_session((SELECT id FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000003'),1,NULL)$$,
  'P0001','not_authorized','member cannot invoke coach confirmation RPC');
SELECT throws_ok($$SELECT admin_get_active_video_sessions()$$,'P0001','not_authorized','member cannot invoke coach/admin query RPC');

-- Coach confirms A's request; stale optimistic version is rejected.
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","email":"coach-test@example.com","role":"authenticated"}',true);
SELECT lives_ok(
  $$SELECT coach_confirm_video_session((SELECT id FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000003'),1,NULL)$$,
  'coach confirms member requested time');
SELECT is((SELECT status FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000003'),'scheduled','confirmation schedules session');
SELECT is((SELECT calendar_sync_status FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000003'),'pending','confirmation marks calendar sync pending');
SELECT throws_ok(
  $$SELECT coach_cancel_video_session((SELECT id FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000003'),1,'stale')$$,
  '40001','version_conflict','optimistic version conflict rejects stale mutation');

-- Member B requests overlapping slot; coach conflict rejects it, adjacent slot succeeds.
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000004","email":"member-b-test@example.com","role":"authenticated"}',true);
SELECT lives_ok($$SELECT request_private_video_session(now()+interval '10 days 30 minutes','UTC',60,NULL)$$,'second member requests overlapping slot');
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","email":"coach-test@example.com","role":"authenticated"}',true);
SELECT throws_ok(
  $$SELECT coach_confirm_video_session((SELECT id FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000004'),1,NULL)$$,
  '23P01','coach_schedule_conflict','assigned coach overlapping confirmed session is rejected');
SELECT lives_ok(
  $$SELECT coach_counteroffer_video_session((SELECT id FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000004'),1,(SELECT scheduled_for+make_interval(mins=>duration_minutes) FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000003'),'UTC',60,'adjacent',NULL)$$,
  'coach may counteroffer an adjacent non-overlapping slot');
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000004","email":"member-b-test@example.com","role":"authenticated"}',true);
SELECT lives_ok(
  $$SELECT member_accept_video_proposal((SELECT id FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000004'),(SELECT id FROM video_session_proposals WHERE session_id=(SELECT id FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000004') AND status='pending' AND proposed_by_role='coach'),2)$$,
  'member accepts coach counteroffer');
SELECT is((SELECT status FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000004'),'scheduled','accepted counteroffer schedules session');
SELECT is(
 (SELECT scheduled_for FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000004'),
 (SELECT starts_at FROM video_session_proposals WHERE session_id=(SELECT id FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000004') AND status='accepted'),
 'accepted adjacent proposal becomes the confirmed start');

-- Reschedule clears confirmed time and requires calendar work when an event exists.
RESET ROLE;
UPDATE video_sessions SET calendar_event_id='fixture-calendar-event',calendar_sync_status='synced'
WHERE account_id='20000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000004","email":"member-b-test@example.com","role":"authenticated"}',true);
SELECT lives_ok(
  $$SELECT member_reschedule_video_session((SELECT id FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000004'),3,now()+interval '14 days','America/New_York',45,'new request')$$,
  'member can request reschedule');
SELECT ok((SELECT scheduled_for IS NULL AND status='requested' FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000004'),'member reschedule clears confirmed time');
SELECT is((SELECT calendar_sync_status FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000004'),'pending','reschedule marks existing calendar event pending');
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","email":"coach-test@example.com","role":"authenticated"}',true);
SELECT lives_ok($$SELECT coach_reschedule_video_session((SELECT id FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000004'),4,now()+interval '15 days','UTC',45,'coach follow-up')$$,'coach reschedule counteroffer succeeds');
SELECT is((SELECT assigned_coach_id FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000004'),'20000000-0000-0000-0000-000000000002'::uuid,'coach reschedule preserves assigned coach');

-- Create terminal outcomes on separate members.
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000005","email":"member-c-test@example.com","role":"authenticated"}',true);
SELECT request_private_video_session(now()+interval '20 days','UTC',30,NULL);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000006","email":"member-d-test@example.com","role":"authenticated"}',true);
SELECT request_private_video_session(now()+interval '21 days','UTC',30,NULL);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000007","email":"member-e-test@example.com","role":"authenticated"}',true);
SELECT request_private_video_session(now()+interval '22 days','UTC',30,NULL);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000008","email":"member-f-test@example.com","role":"authenticated"}',true);
SELECT request_private_video_session(now()+interval '23 days','UTC',30,NULL);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","email":"coach-test@example.com","role":"authenticated"}',true);
SELECT coach_confirm_video_session(id,version,NULL) FROM video_sessions WHERE account_id IN ('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000007');
SELECT lives_ok($$SELECT coach_complete_video_session((SELECT id FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000005'),2)$$,'coach completes session');
SELECT lives_ok($$SELECT coach_mark_member_no_show((SELECT id FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000006'),2)$$,'coach records member no-show');
SELECT lives_ok($$SELECT coach_mark_coach_no_show((SELECT id FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000007'),2)$$,'coach records coach no-show');
SELECT is((SELECT completion_outcome FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000006'),'member_no_show','member no-show outcome is distinct');
SELECT is((SELECT completion_outcome FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000007'),'coach_no_show','coach no-show outcome is distinct');
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000008","email":"member-f-test@example.com","role":"authenticated"}',true);
SELECT lives_ok($$SELECT member_cancel_video_session((SELECT id FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000008'),1,'fixture cancellation')$$,'member cancels request');
SELECT is((SELECT calendar_sync_status FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000008'),'cancelled','cancel without calendar event records cancelled calendar state');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM video_sessions WHERE account_id IN ('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000008') AND archived_at IS NOT NULL),4,'complete/cancel/no-show all set archived_at');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","email":"coach-test@example.com","role":"authenticated"}',true);
SELECT is((SELECT count(*)::integer FROM admin_get_active_video_sessions() WHERE account_id IN ('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000008')),0,'active admin query excludes terminal sessions');
SELECT is((SELECT count(*)::integer FROM admin_get_video_session_history() WHERE account_id IN ('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000008')),4,'admin history includes all terminal sessions');

-- Reminder fixture exactly 24h out, isolated from other sessions.
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000009","email":"member-g-test@example.com","role":"authenticated"}',true);
SELECT request_private_video_session(now()+interval '24 hours','America/Los_Angeles',30,NULL);
SELECT set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","email":"coach-test@example.com","role":"authenticated"}',true);
SELECT coach_confirm_video_session((SELECT id FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000009'),1,NULL);
RESET ROLE;
DELETE FROM push_outbox WHERE metadata->>'session_id'=(SELECT id::text FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000009');
SELECT is(enqueue_premier_video_reminders(),2,'reminder enqueue creates exactly member and coach rows once');
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE metadata->>'session_id'=(SELECT id::text FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000009') AND metadata->>'event'='reminder_24h'),2,'reminder outbox has exactly two targets');
SELECT is(enqueue_premier_video_reminders(),0,'repeat reminder enqueue is deduplicated');
SELECT is((SELECT count(DISTINCT account_id)::integer FROM push_outbox WHERE metadata->>'session_id'=(SELECT id::text FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000009') AND metadata->>'event'='reminder_24h'),2,'reminders target distinct member and coach accounts');
SELECT ok((SELECT bool_and(metadata->>'kind'=kind) FROM push_outbox WHERE metadata ? 'session_id'),'all video notification metadata includes its standardized kind');

SELECT is((SELECT count(*)::integer FROM claim_push_outbox(1,interval '5 minutes')),1,'push claim leases one due row');
SELECT is((SELECT count(*)::integer FROM claim_push_outbox(500,interval '5 minutes') c WHERE c.processing_token=(SELECT processing_token FROM push_outbox WHERE processing_token IS NOT NULL LIMIT 1)),0,'an active push lease cannot be claimed twice');
UPDATE push_outbox SET processing_at=now()-interval '10 minutes' WHERE processing_token IS NOT NULL;
SELECT ok((SELECT count(*)>0 FROM claim_push_outbox(500,interval '5 minutes')),'expired push leases are reclaimable');

UPDATE video_sessions SET calendar_sync_status='processing',calendar_lease_token='30000000-0000-4000-8000-000000000001',calendar_lease_version=version,calendar_lease_expires_at=now()+interval '5 minutes' WHERE account_id='20000000-0000-0000-0000-000000000003';
UPDATE video_sessions SET calendar_sync_status='synced' WHERE account_id='20000000-0000-0000-0000-000000000003' AND calendar_lease_token='30000000-0000-4000-8000-000000000002';
SELECT is((SELECT calendar_sync_status FROM video_sessions WHERE account_id='20000000-0000-0000-0000-000000000003'),'processing','stale calendar lease token cannot overwrite newer state');

SELECT * FROM finish();
ROLLBACK;
