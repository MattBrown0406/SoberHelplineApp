BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(29);

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role) VALUES
 ('11000000-0000-0000-0000-000000000001','plan-owner@example.com','{}','{}','authenticated','authenticated'),
 ('11000000-0000-0000-0000-000000000002','plan-premier@example.com','{}','{}','authenticated','authenticated'),
 ('11000000-0000-0000-0000-000000000003','plan-essential@example.com','{}','{}','authenticated','authenticated'),
 ('11000000-0000-0000-0000-000000000004','plan-duration@example.com','{}','{}','authenticated','authenticated');
UPDATE accounts SET id=('21000000-0000-0000-0000-'||right(user_id::text,12))::uuid,type='direct'
 WHERE user_id::text LIKE '11000000-0000-0000-0000-00000000000%';
INSERT INTO entitlements(account_id,source,tier,expires_at) VALUES
 ('21000000-0000-0000-0000-000000000002','scholarship','premium',now()+interval '30 days'),
 ('21000000-0000-0000-0000-000000000003','scholarship','essential',now()+interval '30 days'),
 ('21000000-0000-0000-0000-000000000004','scholarship','premium',now()+interval '30 days');
INSERT INTO video_staff_roles(account_id,role,active) VALUES ('21000000-0000-0000-0000-000000000001','owner',true);
GRANT SELECT ON coaching_bookings, video_sessions TO authenticated;
GRANT EXECUTE ON FUNCTION is_video_staff(uuid), is_video_owner(uuid) TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000004","email":"plan-duration@example.com","role":"authenticated"}',true);
SELECT throws_ok($$SELECT request_plan_review_video_session(now()+interval '2 days','America/Los_Angeles',90,'plan_review','Review boundaries','[]','{safetyPlan}'::text[],'{"schemaVersion":"1","sections":{"safetyPlan":{}}}'::jsonb,'I choose to share this plan. This is not an emergency service.','en','membership_included')$$,'23514','new row for relation "video_sessions" violates check constraint "video_plan_review_duration"','plan review duration is fixed at 60 minutes');
SELECT set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000002","email":"plan-premier@example.com","role":"authenticated"}',true);
SELECT lives_ok($$SELECT request_plan_review_video_session(now()+interval '2 days','America/Los_Angeles',60,'plan_review','Review boundaries','["What first?"]','{safetyPlan,boundaries}'::text[],'{"schemaVersion":"1","sections":{"safetyPlan":{"hospital":"Example"},"boundaries":{"support":"Treatment"}}}'::jsonb,'I choose to share these sections. This is not an emergency service.','en','membership_included')$$,'Premier can request included plan review');
SELECT is((SELECT appointment_type FROM member_get_active_video_session()),'membership_included','Premier session is membership included');
SELECT is((SELECT payment_status FROM member_get_active_video_session()),'included','Premier session needs no extra payment');
SELECT is((SELECT selected_plan_sections FROM member_get_active_video_session()),'{safetyPlan,boundaries}'::text[],'selected sections are preserved');
RESET ROLE;
SELECT throws_ok($$UPDATE video_sessions SET plan_snapshot='{"changed":true}' WHERE account_id='21000000-0000-0000-0000-000000000002'$$,'P0001','plan_review_snapshot_immutable','booking snapshot is immutable');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000002","email":"plan-premier@example.com","role":"authenticated"}',true);
SELECT throws_ok($$SELECT admin_get_plan_review_prep(ARRAY[(SELECT id FROM member_get_active_video_session())])$$,'P0001','not_authorized','member cannot read private prep notes RPC');

SELECT set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000003","email":"plan-essential@example.com","role":"authenticated"}',true);
SELECT throws_ok($$SELECT request_plan_review_video_session(now()+interval '3 days','UTC',60,'plan_review',NULL,'[]','{safetyPlan}'::text[],'{"schemaVersion":"1","sections":{"safetyPlan":{}}}'::jsonb,'I choose to share this plan. This is not an emergency service.','en','membership_included')$$,'P0001','premier_upgrade_or_payment_required','Essential cannot claim included Premier benefit');
SELECT lives_ok($$SELECT request_plan_review_video_session(now()+interval '3 days','UTC',60,'plan_review',NULL,'[]','{safetyPlan}'::text[],'{"schemaVersion":"1","sections":{"safetyPlan":{}}}'::jsonb,'I choose to share this plan. This is not an emergency service.','en','one_off_150')$$,'Essential can request one-off review');
SELECT is((SELECT payment_status FROM member_get_active_video_session()),'pending_payment','one-off starts pending payment');
SELECT is((SELECT rate_cents FROM coaching_bookings WHERE account_id='21000000-0000-0000-0000-000000000003'),15000,'one-off creates a $150 payment record');

SELECT set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000001","email":"plan-owner@example.com","role":"authenticated"}',true);
SELECT throws_ok($$SELECT coach_confirm_video_session((SELECT id FROM video_sessions WHERE account_id='21000000-0000-0000-0000-000000000003'),1,NULL)$$,'P0001','payment_not_verified','staff cannot confirm unpaid one-off');
SELECT lives_ok($$SELECT admin_update_plan_review_prep((SELECT id FROM video_sessions WHERE account_id='21000000-0000-0000-0000-000000000003'),'Prepare boundary examples')$$,'staff can save private prep notes');
SELECT is((SELECT notes FROM admin_get_plan_review_prep(ARRAY[(SELECT id FROM video_sessions WHERE account_id='21000000-0000-0000-0000-000000000003')])), 'Prepare boundary examples','staff can retrieve private prep notes');
SELECT lives_ok($$SELECT admin_request_plan_review_update((SELECT id FROM video_sessions WHERE account_id='21000000-0000-0000-0000-000000000003'),'Update before meeting')$$,'staff can request an updated plan');
SELECT set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000003","email":"plan-essential@example.com","role":"authenticated"}',true);
SELECT lives_ok($$SELECT member_submit_plan_review_revision((SELECT id FROM member_get_active_video_session()),'{safetyPlan,boundaries}'::text[],'{"schemaVersion":"1","sections":{"safetyPlan":{"updated":true},"boundaries":{"updated":true}}}'::jsonb,'I choose to share this updated plan. This is not an emergency service.','en')$$,'member can submit a newly consented immutable revision');
SELECT is((SELECT plan_snapshot->'sections'->'safetyPlan' FROM member_get_active_video_session()),'{}'::jsonb,'original booking snapshot remains unchanged');
SELECT set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000001","email":"plan-owner@example.com","role":"authenticated"}',true);
SELECT is((SELECT max(revision_number) FROM admin_get_plan_review_revisions(ARRAY[(SELECT id FROM video_sessions WHERE account_id='21000000-0000-0000-0000-000000000003')])),1,'staff can retrieve the latest plan revision');
SELECT throws_ok($$SELECT apply_plan_review_payment_event('capture.forbidden.001',(SELECT id FROM video_sessions WHERE account_id='21000000-0000-0000-0000-000000000003'),'ORDER-001','CAPTURE-001','captured',15000,'USD',now())$$,'42501','permission denied for function apply_plan_review_payment_event','authenticated staff cannot forge website payment events');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT lives_ok($$SELECT apply_plan_review_payment_event('capture.event.001',(SELECT id FROM video_sessions WHERE account_id='21000000-0000-0000-0000-000000000003'),'ORDER-001','CAPTURE-001','captured',15000,'USD',now())$$,'signed bridge service can apply verified capture');
SELECT is((SELECT payment_status FROM video_sessions WHERE account_id='21000000-0000-0000-0000-000000000003'),'paid','verified capture marks video session paid');
SELECT is((apply_plan_review_payment_event('capture.event.001',(SELECT id FROM video_sessions WHERE account_id='21000000-0000-0000-0000-000000000003'),'ORDER-001','CAPTURE-001','captured',15000,'USD',now())->>'duplicate')::boolean,true,'duplicate event id is idempotent');
SELECT throws_ok($$SELECT apply_plan_review_payment_event('capture.event.badamount',(SELECT id FROM video_sessions WHERE account_id='21000000-0000-0000-0000-000000000003'),'ORDER-002','CAPTURE-002','captured',14999,'USD',now())$$,'P0001','invalid_payment_event','wrong amount is rejected');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000001","email":"plan-owner@example.com","role":"authenticated"}',true);
SELECT lives_ok($$SELECT coach_confirm_video_session((SELECT id FROM video_sessions WHERE account_id='21000000-0000-0000-0000-000000000003'),4,NULL)$$,'verified one-off can be confirmed');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT lives_ok($$SELECT apply_plan_review_payment_event('refund.event.001',(SELECT id FROM video_sessions WHERE account_id='21000000-0000-0000-0000-000000000003'),'ORDER-001','CAPTURE-001','refunded',15000,'USD',now())$$,'verified refund propagates to app payment truth');
SELECT is((SELECT payment_status FROM video_sessions WHERE account_id='21000000-0000-0000-0000-000000000003'),'refunded','refund marks linked video session refunded');
SELECT is((SELECT status FROM video_sessions WHERE account_id='21000000-0000-0000-0000-000000000003'),'cancelled','refund cancels an active plan-review session');
SELECT is((SELECT calendar_sync_status FROM video_sessions WHERE account_id='21000000-0000-0000-0000-000000000003'),'cancelled','refund leaves no unsynchronised calendar event when none exists');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000001","email":"plan-owner@example.com","role":"authenticated"}',true);
SELECT throws_ok($$SELECT coach_start_video_session((SELECT id FROM video_sessions WHERE account_id='21000000-0000-0000-0000-000000000003'),6)$$,'P0001','invalid_transition','cancelled refunded session cannot transition live');

SELECT * FROM finish();
ROLLBACK;
