BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(15);

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role) VALUES
 ('16000000-0000-0000-0000-000000000001','pass2-owner@example.com','{}','{}','authenticated','authenticated'),
 ('16000000-0000-0000-0000-000000000002','pass2-essential@example.com','{}','{}','authenticated','authenticated'),
 ('16000000-0000-0000-0000-000000000003','pass2-attached@example.com','{}','{}','authenticated','authenticated'),
 ('16000000-0000-0000-0000-000000000004','pass2-relative@example.com','{}','{}','authenticated','authenticated');
UPDATE accounts SET id=('26000000-0000-0000-0000-'||right(user_id::text,12))::uuid, type='direct'
 WHERE user_id::text LIKE '16000000-0000-0000-0000-00000000000%';
INSERT INTO entitlements(account_id,source,tier,expires_at)
VALUES ('26000000-0000-0000-0000-000000000002','scholarship','essential',now()+interval '30 days');
INSERT INTO video_staff_roles(account_id,role,active) VALUES ('26000000-0000-0000-0000-000000000001','owner',true);

-- ── Suspended provider ends attached access ─────────────────────────────────
INSERT INTO orgs(id,name) VALUES ('a6000000-0000-0000-0000-000000000001','Pass2 Provider');
UPDATE accounts SET type='attached', org_id='a6000000-0000-0000-0000-000000000001'
 WHERE id='26000000-0000-0000-0000-000000000003';
SELECT ok(has_active_textline_access('26000000-0000-0000-0000-000000000003'), 'an active provider grants access');
UPDATE orgs SET status='suspended' WHERE id='a6000000-0000-0000-0000-000000000001';
SELECT ok(NOT has_active_textline_access('26000000-0000-0000-0000-000000000003')
  AND NOT has_active_private_video_access('26000000-0000-0000-0000-000000000003'),
  'a suspended provider no longer grants access');

-- ── Private wavering stays private ──────────────────────────────────────────
INSERT INTO family_spaces(id,name,created_by,invite_code)
VALUES ('76000000-0000-0000-0000-000000000001','Pass2 family','26000000-0000-0000-0000-000000000002','PAS2-0001');
INSERT INTO family_members(family_space_id,account_id,role) VALUES
 ('76000000-0000-0000-0000-000000000001','26000000-0000-0000-0000-000000000002','owner'),
 ('76000000-0000-0000-0000-000000000001','26000000-0000-0000-0000-000000000004','member');
INSERT INTO shared_walls(id,family_space_id,text,proposed_by)
VALUES ('86000000-0000-0000-0000-000000000001','76000000-0000-0000-0000-000000000001','No cash','26000000-0000-0000-0000-000000000002');
INSERT INTO wall_commitments(shared_wall_id,account_id,status)
VALUES ('86000000-0000-0000-0000-000000000001','26000000-0000-0000-0000-000000000002','committed');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"16000000-0000-0000-0000-000000000002","email":"pass2-essential@example.com","role":"authenticated"}',true);
SELECT lives_ok($$SELECT record_wall_wavering('86000000-0000-0000-0000-000000000001', false)$$, 'member records a private wavering');
SELECT set_config('request.jwt.claims','{"sub":"16000000-0000-0000-0000-000000000004","email":"pass2-relative@example.com","role":"authenticated"}',true);
SELECT is((SELECT status FROM wall_commitments WHERE shared_wall_id='86000000-0000-0000-0000-000000000001' AND account_id='26000000-0000-0000-0000-000000000002'),
  'committed', 'a relative does not see a wavering kept private');
SELECT is((SELECT count(*)::integer FROM wavering_events WHERE shared_wall_id='86000000-0000-0000-0000-000000000001'), 0,
  'a relative cannot read the private wavering event');
RESET ROLE;

-- ── A paid plan review cancelled before payment ─────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"16000000-0000-0000-0000-000000000002","email":"pass2-essential@example.com","role":"authenticated"}',true);
SELECT lives_ok($$SELECT request_plan_review_video_session(now()+interval '3 days','UTC',60,'plan_review',NULL,'[]','{safetyPlan}'::text[],'{"schemaVersion":"1","sections":{"safetyPlan":{}}}'::jsonb,'I choose to share this plan. This is not an emergency service.','en','one_off_150')$$,
  'essential member requests a paid plan review');
SELECT lives_ok($$SELECT member_cancel_video_session((SELECT id FROM member_get_active_video_session()),(SELECT version FROM member_get_active_video_session()),'changed my mind')$$,
  'member cancels before paying');
RESET ROLE;

-- ── A capture after cancellation is recorded and flagged, not lost ──────────
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is((apply_plan_review_payment_event('pass2.capture.late.01',
  (SELECT id FROM video_sessions WHERE account_id='26000000-0000-0000-0000-000000000002'),
  'ORDER-LATE-1','CAPTURE-LATE-1','captured',15000,'USD',now())->>'refund_owed')::boolean,
  true, 'a capture for a cancelled session is flagged as owed back');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE kind='admin_refund_owed' AND account_id='26000000-0000-0000-0000-000000000001'), 1,
  'the owner is alerted to the refund');
SELECT is((SELECT status FROM video_sessions WHERE account_id='26000000-0000-0000-0000-000000000002'), 'cancelled',
  'the late capture does not revive the cancelled session');

-- ── Refund, then a stray capture, then a failed attempt ──────────────────────
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT apply_plan_review_payment_event('pass2.refund.late.01',
  (SELECT id FROM video_sessions WHERE account_id='26000000-0000-0000-0000-000000000002'),
  'ORDER-LATE-1','CAPTURE-LATE-1','refunded',15000,'USD',now());
SELECT is((apply_plan_review_payment_event('pass2.capture.late.02',
  (SELECT id FROM video_sessions WHERE account_id='26000000-0000-0000-0000-000000000002'),
  'ORDER-LATE-2','CAPTURE-LATE-2','captured',15000,'USD',now())->>'refund_owed')::boolean,
  true, 'a capture on an already refunded session is recorded and flagged, not rejected');
SELECT apply_plan_review_payment_event('pass2.refund.late.02',
  (SELECT id FROM video_sessions WHERE account_id='26000000-0000-0000-0000-000000000002'),
  'ORDER-LATE-2','CAPTURE-LATE-2','refunded',15000,'USD',now());
SELECT lives_ok($$SELECT apply_plan_review_payment_event('pass2.failed.late.03',
  (SELECT id FROM video_sessions WHERE account_id='26000000-0000-0000-0000-000000000002'),
  'ORDER-LATE-3','CAPTURE-LATE-3','failed',15000,'USD',now())$$, 'a failed attempt after a refund is recorded');
RESET ROLE;
SELECT is((SELECT payment_status FROM video_sessions WHERE account_id='26000000-0000-0000-0000-000000000002'), 'refunded',
  'a failed attempt does not make a refunded session read as awaiting payment');

-- ── A session left live is closed so the member can book again ──────────────
-- Fixture only: force a stale live session (the payment guard would refuse it).
SET LOCAL session_replication_role = replica;
UPDATE video_sessions SET status='live', started_at=now()-interval '5 hours', archived_at=NULL
 WHERE account_id='26000000-0000-0000-0000-000000000002';
SET LOCAL session_replication_role = origin;
SELECT is(close_stale_live_video_sessions(), 1, 'a session live for over 4 hours is closed');
SELECT is((SELECT status FROM video_sessions WHERE account_id='26000000-0000-0000-0000-000000000002'), 'completed',
  'the stale live session is completed');

SELECT * FROM finish();
ROLLBACK;
