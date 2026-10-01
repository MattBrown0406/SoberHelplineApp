BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

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
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000001","email":"plan-owner@example.com","role":"authenticated"}',true);
SELECT lives_ok($$SELECT admin_request_plan_review_update((SELECT id FROM video_sessions WHERE account_id='21000000-0000-0000-0000-000000000002'),'Update before meeting')$$,'real producer accepts request for eligible premium member');
RESET ROLE;
UPDATE accounts SET push_token='ExponentPushToken[synthetic-final-review]' WHERE id='21000000-0000-0000-0000-000000000002';
UPDATE push_outbox SET processing_at=now(),processing_token='ff000000-0000-0000-0000-000000000001' WHERE account_id='21000000-0000-0000-0000-000000000002' AND kind='member_plan_update_requested';
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE account_id='21000000-0000-0000-0000-000000000002' AND kind='member_plan_update_requested'),1,'actual producer creates the missing kind');
SELECT ok((SELECT dispatcher_outbox_delivery(id,processing_token) IS NOT NULL FROM push_outbox WHERE kind='member_plan_update_requested'),'actual producer delivers current outstanding request');
UPDATE entitlements SET expires_at=now()-interval '1 second' WHERE account_id='21000000-0000-0000-0000-000000000002';
SELECT ok((SELECT dispatcher_outbox_delivery(id,processing_token) IS NULL FROM push_outbox WHERE kind='member_plan_update_requested'),'access loss denies update request');
UPDATE entitlements SET expires_at=now()+interval '30 days' WHERE account_id='21000000-0000-0000-0000-000000000002';
UPDATE video_sessions SET update_requested_at=NULL WHERE account_id='21000000-0000-0000-0000-000000000002';
SELECT ok((SELECT dispatcher_outbox_delivery(id,processing_token) IS NULL FROM push_outbox WHERE kind='member_plan_update_requested'),'withdrawn outstanding request denied even without version change');
UPDATE video_sessions SET update_requested_at=now() WHERE account_id='21000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"11000000-0000-0000-0000-000000000002","email":"plan-premier@example.com","role":"authenticated"}',true);
SELECT lives_ok($$SELECT member_submit_plan_review_revision((SELECT id FROM video_sessions WHERE account_id='21000000-0000-0000-0000-000000000002'),'{safetyPlan,boundaries}'::text[],'{"schemaVersion":"1","sections":{"safetyPlan":{},"boundaries":{}}}'::jsonb,'I choose to share this updated plan. This is not an emergency service.','en')$$,'real revision RPC resolves the outstanding request');
RESET ROLE;
SELECT ok((SELECT dispatcher_outbox_delivery(id,processing_token) IS NULL FROM push_outbox WHERE kind='member_plan_update_requested'),'actual submitted revision suppresses stale request notification');
SELECT * FROM finish();
ROLLBACK;
