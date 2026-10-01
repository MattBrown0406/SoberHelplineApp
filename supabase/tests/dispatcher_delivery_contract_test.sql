BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role) VALUES
 ('dd100000-0000-0000-0000-000000000001','dispatcher-member@example.invalid','{}','{}','authenticated','authenticated'),
 ('dd100000-0000-0000-0000-000000000002','matt@soberhelpline.com','{}','{}','authenticated','authenticated'),
 ('dd100000-0000-0000-0000-000000000003','dispatcher-coach@example.invalid','{}','{}','authenticated','authenticated');
CREATE FUNCTION pg_temp.aid(n integer) RETURNS uuid LANGUAGE sql AS $$
 SELECT id FROM accounts WHERE user_id=('dd100000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid
$$;
UPDATE accounts SET push_token='ExponentPushToken['||id::text||']',created_at=now()-interval '30 days',daily_push_opt_in=true,family_call_reminders=true
WHERE id IN (pg_temp.aid(1),pg_temp.aid(2),pg_temp.aid(3));
INSERT INTO entitlements(account_id,source,tier,expires_at) VALUES(pg_temp.aid(1),'scholarship','premium',now()+interval '30 days');
INSERT INTO video_staff_roles(account_id,role,active) VALUES(pg_temp.aid(2),'owner',true),(pg_temp.aid(3),'coach',true)
ON CONFLICT(account_id) DO UPDATE SET role=excluded.role,active=true;
CREATE FUNCTION pg_temp.enqueue(k text,a uuid,m jsonb DEFAULT '{}',ikey text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE rid uuid;
BEGIN
 INSERT INTO push_outbox(account_id,kind,title,body,metadata,idempotency_key,processing_at,processing_token)
 VALUES(a,k,'Synthetic','Synthetic',m,ikey,now(),'dd600000-0000-0000-0000-000000000001') RETURNING id INTO rid;
 RETURN rid;
END $$;
CREATE FUNCTION pg_temp.delivery(rid uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT dispatcher_outbox_delivery(rid,'dd600000-0000-0000-0000-000000000001')
$$;
CREATE TEMP TABLE work(kind text PRIMARY KEY,id uuid);
SELECT ok(NOT has_function_privilege('authenticated','dispatcher_outbox_delivery(uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','dispatcher_outbox_delivery(uuid,uuid)','EXECUTE')
 AND has_function_privilege('service_role','dispatcher_outbox_delivery(uuid,uuid)','EXECUTE'),'outbox boundary service only');
SELECT ok(NOT has_function_privilege('authenticated','dispatcher_job_delivery(text,uuid,uuid,timestamptz,timestamptz,boolean)','EXECUTE')
 AND NOT has_function_privilege('anon','dispatcher_job_targets(text,boolean,uuid,timestamptz)','EXECUTE'),'direct boundary service only');

-- Practice consent withdrawal cancels the actual claim; neither retries nor
-- re-opt-in may create a new lifetime for an existing event.
INSERT INTO practice_push_preferences(account_id,enabled,frequency_per_week,window_start_hour,window_end_hour)
VALUES(pg_temp.aid(1),true,2,9,20);
INSERT INTO practice_push_events(event_id,account_id,expires_at) VALUES
 ('dd700000-0000-0000-0000-000000000001',pg_temp.aid(1),now()+interval '30 minutes');
INSERT INTO work SELECT 'practice',pg_temp.enqueue('practice_incoming',pg_temp.aid(1),jsonb_build_object('event_id','dd700000-0000-0000-0000-000000000001','expires_at',now()+interval '30 minutes'));
SELECT ok(pg_temp.delivery(id) IS NOT NULL,'practice positive control') FROM work WHERE kind='practice';
SELECT is(dispatcher_outbox_delivery(id,gen_random_uuid()),NULL,'practice rejects stale claim') FROM work WHERE kind='practice';
UPDATE push_outbox SET scheduled_for=now()-interval '1 minute',expires_at=now()+interval '1 day' WHERE id=(SELECT id FROM work WHERE kind='practice');
SELECT is((pg_temp.delivery(id)->>'ttl')::integer,1800,'practice retry cannot extend original deadline') FROM work WHERE kind='practice';
SELECT throws_ok($$UPDATE push_outbox SET metadata='{}' WHERE id=(SELECT id FROM work WHERE kind='practice')$$,'P0001','push_identity_immutable','practice event cannot be swapped under claim');
UPDATE accounts SET push_token='ExponentPushToken[rotated]' WHERE id=pg_temp.aid(1);
SELECT is(pg_temp.delivery(id)->>'push_token','ExponentPushToken[rotated]','destination resolved from current account') FROM work WHERE kind='practice';
UPDATE accounts SET push_token=NULL WHERE id=pg_temp.aid(1);
UPDATE accounts SET push_token='ExponentPushToken[rotated]' WHERE id=pg_temp.aid(3);
SELECT is(pg_temp.delivery(id),NULL,'token now owned by another account never receives old work') FROM work WHERE kind='practice';
UPDATE accounts SET push_token='ExponentPushToken[member-new]' WHERE id=pg_temp.aid(1);
UPDATE practice_push_events SET answered_at=now() WHERE event_id='dd700000-0000-0000-0000-000000000001';
SELECT is(pg_temp.delivery(id),NULL,'answered practice drops') FROM work WHERE kind='practice';
UPDATE practice_push_events SET answered_at=NULL WHERE event_id='dd700000-0000-0000-0000-000000000001';
UPDATE entitlements SET expires_at=now()-interval '1 second' WHERE account_id=pg_temp.aid(1);
SELECT is(pg_temp.delivery(id),NULL,'practice access revoked') FROM work WHERE kind='practice';
UPDATE entitlements SET expires_at=now()+interval '30 days' WHERE account_id=pg_temp.aid(1);
UPDATE practice_push_preferences SET enabled=false WHERE account_id=pg_temp.aid(1);
UPDATE practice_push_preferences SET enabled=true WHERE account_id=pg_temp.aid(1);
SELECT ok(o.failed_at IS NOT NULL AND o.processing_token IS NULL,'practice withdrawal canceled pending lease') FROM push_outbox o JOIN work w USING(id) WHERE w.kind='practice';
SELECT is(pg_temp.delivery(id),NULL,'re-opt-in cannot revive practice') FROM work WHERE kind='practice';

-- Live groups: event identity, active host, current RSVP, ban and paid access.
INSERT INTO group_hosts(room_name,account_id,is_live,live_started_at,live_event_id)
VALUES('shp-parents',pg_temp.aid(2),true,now()-interval '1 minute','dd700000-0000-0000-0000-000000000002');
INSERT INTO group_rsvps(room_name,account_id) VALUES('shp-parents',pg_temp.aid(1));
INSERT INTO work SELECT 'group',pg_temp.enqueue('group_live',pg_temp.aid(1),' {"room_name":"shp-parents","event_id":"dd700000-0000-0000-0000-000000000002"}');
SELECT is((pg_temp.delivery(id)->>'ttl')::integer,10740,'live event has original 3h deadline') FROM work WHERE kind='group';
UPDATE group_hosts SET is_live=false WHERE room_name='shp-parents';
SELECT is(pg_temp.delivery(id),NULL,'ended live group drops') FROM work WHERE kind='group';
UPDATE group_hosts SET is_live=true,live_event_id=gen_random_uuid() WHERE room_name='shp-parents';
SELECT is(pg_temp.delivery(id),NULL,'new broadcast does not revive prior event') FROM work WHERE kind='group';
UPDATE group_hosts SET live_event_id='dd700000-0000-0000-0000-000000000002' WHERE room_name='shp-parents';
DELETE FROM group_rsvps WHERE account_id=pg_temp.aid(1);
SELECT is(pg_temp.delivery(id),NULL,'removed group RSVP drops') FROM work WHERE kind='group';
INSERT INTO group_rsvps(room_name,account_id) VALUES('shp-parents',pg_temp.aid(1));
UPDATE entitlements SET expires_at=now()-interval '1 second' WHERE account_id=pg_temp.aid(1);
SELECT is(pg_temp.delivery(id),NULL,'live group access lost') FROM work WHERE kind='group';
UPDATE entitlements SET expires_at=now()+interval '30 days' WHERE account_id=pg_temp.aid(1);
INSERT INTO live_group_bans(account_id,room_name) VALUES(pg_temp.aid(1),'shp-parents');
SELECT is(pg_temp.delivery(id),NULL,'banned member drops') FROM work WHERE kind='group';
DELETE FROM live_group_bans WHERE account_id=pg_temp.aid(1);
SELECT ok(pg_temp.delivery(id) IS NOT NULL,'live valid control retained') FROM work WHERE kind='group';

-- Every video kind has a positive control and a stale-state denial.
INSERT INTO video_sessions(id,account_id,room_name,status,scheduled_for,requested_start,requested_timezone,duration_minutes,assigned_coach_id)
VALUES('dd800000-0000-0000-0000-000000000001',pg_temp.aid(1),'synthetic-room','scheduled',now()+interval '1 hour',now()+interval '1 hour','UTC',30,pg_temp.aid(3));
CREATE FUNCTION pg_temp.video_matrix() RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE k text; st text; rid uuid; recipient uuid;
BEGIN
 FOREACH k IN ARRAY ARRAY['admin_video_request','member_video_scheduled','member_video_counteroffer','member_video_live','member_video_cancelled','member_video_completed','member_video_no_show','coach_video_accepted','coach_video_cancelled','coach_video_reschedule','premier_video_reminder','coach_video_reminder'] LOOP
 st:=CASE WHEN k IN ('admin_video_request','member_video_counteroffer','coach_video_reschedule') THEN 'requested'
 WHEN k LIKE '%cancelled' THEN 'cancelled' WHEN k='member_video_completed' THEN 'completed' WHEN k='member_video_no_show' THEN 'no_show'
 WHEN k='member_video_live' THEN 'live' ELSE 'scheduled' END;
 UPDATE video_sessions SET status=st,version=version+1 WHERE id='dd800000-0000-0000-0000-000000000001';
 recipient:=CASE WHEN k='admin_video_request' THEN pg_temp.aid(2) WHEN k LIKE 'coach%' THEN pg_temp.aid(3) ELSE pg_temp.aid(1) END;
 rid:=pg_temp.enqueue(k,recipient,'{"session_id":"dd800000-0000-0000-0000-000000000001"}');
 RETURN NEXT ok(pg_temp.delivery(rid) IS NOT NULL,k||' positive control');
 UPDATE video_sessions SET version=version+1 WHERE id='dd800000-0000-0000-0000-000000000001';
 RETURN NEXT is(pg_temp.delivery(rid),NULL,k||' changed state/version drops');
 END LOOP;
END $$;
SELECT * FROM pg_temp.video_matrix();
UPDATE video_sessions SET status='scheduled',version=version+1 WHERE id='dd800000-0000-0000-0000-000000000001';
INSERT INTO work SELECT 'coach',pg_temp.enqueue('coach_video_reminder',pg_temp.aid(3),'{"session_id":"dd800000-0000-0000-0000-000000000001"}');
UPDATE video_sessions SET assigned_coach_id=pg_temp.aid(2) WHERE id='dd800000-0000-0000-0000-000000000001';
SELECT is(pg_temp.delivery(id),NULL,'coach reassignment denied even without version bump') FROM work WHERE kind='coach';
UPDATE video_sessions SET assigned_coach_id=pg_temp.aid(3) WHERE id='dd800000-0000-0000-0000-000000000001';
UPDATE video_staff_roles SET active=false WHERE account_id=pg_temp.aid(3);
SELECT is(pg_temp.delivery(id),NULL,'inactive coach drops') FROM work WHERE kind='coach';
UPDATE video_staff_roles SET active=true WHERE account_id=pg_temp.aid(3);
SELECT ok(pg_temp.delivery(id) IS NOT NULL,'active assigned coach restored') FROM work WHERE kind='coach';
SELECT _video_push(pg_temp.aid(2),'admin_video_request','Synthetic','Synthetic','dd800000-0000-0000-0000-000000000001',999,'requested');
SELECT _video_push(pg_temp.aid(3),'admin_video_request','Synthetic','Synthetic','dd800000-0000-0000-0000-000000000001',999,'requested');
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE idempotency_key LIKE 'video:%:999:requested:%'),2,'video request fanout key includes both staff recipients');

-- Current video schedule/access checks, with terminal-notice controls.
INSERT INTO work SELECT 'member-video',pg_temp.enqueue('premier_video_reminder',pg_temp.aid(1),'{"session_id":"dd800000-0000-0000-0000-000000000001"}');
UPDATE video_sessions SET scheduled_for=scheduled_for+interval '1 hour' WHERE id='dd800000-0000-0000-0000-000000000001';
SELECT is(pg_temp.delivery(id),NULL,'changed appointment time drops without a version bump') FROM work WHERE kind='member-video';
UPDATE video_sessions SET scheduled_for=scheduled_for-interval '1 hour' WHERE id='dd800000-0000-0000-0000-000000000001';
UPDATE entitlements SET expires_at=now()-interval '1 second' WHERE account_id=pg_temp.aid(1);
SELECT is(pg_temp.delivery(id),NULL,'member video access loss drops active reminder') FROM work WHERE kind='member-video';
UPDATE video_sessions SET status='cancelled',version=version+1 WHERE id='dd800000-0000-0000-0000-000000000001';
INSERT INTO work SELECT 'terminal-video',pg_temp.enqueue('member_video_cancelled',pg_temp.aid(1),'{"session_id":"dd800000-0000-0000-0000-000000000001"}');
SELECT ok(pg_temp.delivery(id) IS NOT NULL,'cancellation remains useful after membership ends') FROM work WHERE kind='terminal-video';
UPDATE entitlements SET expires_at=now()+interval '30 days' WHERE account_id=pg_temp.aid(1);

-- Community and operational/admin alerts retain their legitimate routing.
INSERT INTO community_posts(id,account_id,body,status) VALUES('dd900000-0000-0000-0000-000000000001',pg_temp.aid(1),'Synthetic','visible');
INSERT INTO community_supports(post_id,supporter_account_id) VALUES('dd900000-0000-0000-0000-000000000001',pg_temp.aid(3));
INSERT INTO community_reports(post_id,reporter_account_id) VALUES('dd900000-0000-0000-0000-000000000001',pg_temp.aid(3));
INSERT INTO work SELECT 'community',pg_temp.enqueue('community_support',pg_temp.aid(1),'{"post_id":"dd900000-0000-0000-0000-000000000001"}');
INSERT INTO work SELECT 'report',pg_temp.enqueue('admin_community_report',pg_temp.aid(2),'{"post_id":"dd900000-0000-0000-0000-000000000001"}');
SELECT ok(pg_temp.delivery(id) IS NOT NULL,kind||' positive control') FROM work WHERE kind IN ('community','report');
UPDATE community_posts SET status='held' WHERE id='dd900000-0000-0000-0000-000000000001';
SELECT is(pg_temp.delivery(id),NULL,'held post support drops') FROM work WHERE kind='community';
SELECT ok(pg_temp.delivery(id) IS NOT NULL,'held post still needs moderation') FROM work WHERE kind='report';
INSERT INTO situation_briefs(id,account_id,band,score) VALUES('dd900000-0000-0000-0000-000000000002',pg_temp.aid(1),'calm',0);
INSERT INTO work SELECT 'brief',pg_temp.enqueue('situation_brief',pg_temp.aid(2),'{"brief_id":"dd900000-0000-0000-0000-000000000002"}');
INSERT INTO invitation_attempts(id,account_id,outcome,local_date) VALUES('dd900000-0000-0000-0000-000000000003',pg_temp.aid(1),'yes',current_date);
INSERT INTO work SELECT 'yes',pg_temp.enqueue('admin_invitation_yes',pg_temp.aid(2),'{}','invitation-yes:dd900000-0000-0000-0000-000000000003:'||pg_temp.aid(2));
INSERT INTO threads(id,account_id,kind,last_member_message_at) VALUES('dd900000-0000-0000-0000-000000000004',pg_temp.aid(1),'oncall',now());
INSERT INTO work SELECT 'textline',pg_temp.enqueue('admin_textline_message',pg_temp.aid(2),'{"thread_id":"dd900000-0000-0000-0000-000000000004"}');
UPDATE video_sessions SET status='cancelled',payment_status='paid' WHERE id='dd800000-0000-0000-0000-000000000001';
INSERT INTO work SELECT 'refund',pg_temp.enqueue('admin_refund_owed',pg_temp.aid(2),'{"session_id":"dd800000-0000-0000-0000-000000000001"}');
SELECT ok(pg_temp.delivery(id) IS NOT NULL,kind||' positive control') FROM work WHERE kind IN ('brief','yes','textline','refund');
UPDATE video_sessions SET payment_status='refunded' WHERE id='dd800000-0000-0000-0000-000000000001';
SELECT is(pg_temp.delivery(id),NULL,'refunded obligation no longer alerts') FROM work WHERE kind='refund';
UPDATE video_sessions SET payment_status='paid' WHERE id='dd800000-0000-0000-0000-000000000001';
UPDATE threads SET last_admin_read_at=now() WHERE id='dd900000-0000-0000-0000-000000000004';
SELECT is(pg_temp.delivery(id),NULL,'textline read after claim drops') FROM work WHERE kind='textline';
UPDATE situation_briefs SET read_at=now() WHERE id='dd900000-0000-0000-0000-000000000002';
SELECT is(pg_temp.delivery(id),NULL,'read brief drops') FROM work WHERE kind='brief';
UPDATE auth.users SET email='former-admin@example.invalid' WHERE id='dd100000-0000-0000-0000-000000000002';
SELECT is(pg_temp.delivery(id),NULL,kind||' revoked admin denied') FROM work WHERE kind IN ('report','yes');
UPDATE video_staff_roles SET active=false WHERE account_id=pg_temp.aid(2);
SELECT is(pg_temp.delivery(id),NULL,'refund alert owner demoted') FROM work WHERE kind='refund';
UPDATE video_staff_roles SET active=true WHERE account_id=pg_temp.aid(2);
UPDATE video_sessions SET status='scheduled',payment_status='included',appointment_type='membership_included' WHERE id='dd800000-0000-0000-0000-000000000001';
INSERT INTO plan_review_payment_events(event_id,session_id,paypal_order_id,paypal_capture_id,payment_status,amount_cents,currency)
VALUES('dispatcher.capture.1','dd800000-0000-0000-0000-000000000001','ORDER-DISPATCH','CAPTURE-DISPATCH-1','captured',15000,'USD');
SELECT ok(pg_temp.delivery(id) IS NOT NULL,'included appointment with captured payment still owes refund') FROM work WHERE kind='refund';
INSERT INTO plan_review_payment_events(event_id,session_id,paypal_order_id,paypal_capture_id,payment_status,amount_cents,currency)
VALUES('dispatcher.refund.1','dd800000-0000-0000-0000-000000000001','ORDER-DISPATCH','CAPTURE-DISPATCH-1','refunded',15000,'USD');
SELECT is(pg_temp.delivery(id),NULL,'included appointment refund clears obligation') FROM work WHERE kind='refund';
DELETE FROM plan_review_payment_events WHERE event_id='dispatcher.refund.1';
UPDATE video_sessions SET appointment_type='one_off_150',payment_status='paid' WHERE id='dd800000-0000-0000-0000-000000000001';
SELECT is(pg_temp.delivery(id),NULL,'single capture paying active one-off is not a refund obligation') FROM work WHERE kind='refund';
INSERT INTO plan_review_payment_events(event_id,session_id,paypal_order_id,paypal_capture_id,payment_status,amount_cents,currency)
VALUES('dispatcher.capture.2','dd800000-0000-0000-0000-000000000001','ORDER-DISPATCH-2','CAPTURE-DISPATCH-2','captured',15000,'USD');
SELECT ok(pg_temp.delivery(id) IS NOT NULL,'duplicate unrefunded capture owes refund') FROM work WHERE kind='refund';
UPDATE community_posts SET status='removed' WHERE id='dd900000-0000-0000-0000-000000000001';
UPDATE auth.users SET email='matt@soberhelpline.com' WHERE id='dd100000-0000-0000-0000-000000000002';
SELECT is(pg_temp.delivery(id),NULL,'removed report already acted upon') FROM work WHERE kind='report';
DELETE FROM invitation_attempts WHERE id='dd900000-0000-0000-0000-000000000003';
SELECT is(pg_temp.delivery(id),NULL,'deleted yes event is no longer relevant') FROM work WHERE kind='yes';
UPDATE threads SET last_admin_read_at=NULL,archived_at=now() WHERE id='dd900000-0000-0000-0000-000000000004';
SELECT is(pg_temp.delivery(id),NULL,'archived textline no longer prompts reply') FROM work WHERE kind='textline';


-- Current free-call preferences and RSVP are rechecked using an explicit clock
-- (service-only optional clock defaults to now() in the actual handler).
CREATE FUNCTION pg_temp.call_delivery(k text,at_time timestamptz DEFAULT '2026-10-06T01:30:00Z',deadline timestamptz DEFAULT '2026-10-06T02:00:00Z') RETURNS jsonb LANGUAGE sql AS $$
 SELECT dispatcher_job_delivery(k,pg_temp.aid(1),family_squares_session_id(),deadline,at_time)
$$;
DELETE FROM session_rsvps WHERE account_id=pg_temp.aid(1);
SELECT ok(pg_temp.call_delivery('family_call_30min') IS NOT NULL,'free family call positive control');
SELECT is(pg_temp.call_delivery('session_reminder'),NULL,'session reminder requires going RSVP');
INSERT INTO session_rsvps(account_id,session_id,status) VALUES(pg_temp.aid(1),family_squares_session_id(),'going');
SELECT ok(pg_temp.call_delivery('session_reminder') IS NOT NULL,'going RSVP valid');
UPDATE accounts SET family_call_reminders=false WHERE id=pg_temp.aid(1);
SELECT is(pg_temp.call_delivery('session_reminder'),NULL,'going RSVP does not override current optout');
UPDATE accounts SET family_call_reminders=true WHERE id=pg_temp.aid(1);
SELECT is(pg_temp.call_delivery('family_call_30min'),NULL,'30min excludes going to avoid duplicate');
UPDATE session_rsvps SET status='declined' WHERE account_id=pg_temp.aid(1);
SELECT is(pg_temp.call_delivery('session_reminder'),NULL,'declined session drops');
SELECT is(pg_temp.call_delivery('family_call_30min'),NULL,'declined family call drops');
DELETE FROM session_rsvps WHERE account_id=pg_temp.aid(1);
UPDATE accounts SET family_call_reminders=false WHERE id=pg_temp.aid(1);
SELECT is(pg_temp.call_delivery('family_call_30min'),NULL,'family call optout drops');
UPDATE accounts SET family_call_reminders=true WHERE id=pg_temp.aid(1);
SELECT is(pg_temp.call_delivery('family_call_30min','2026-10-06T02:00:00Z'),NULL,'call-start absolute deadline drops');
SELECT is(pg_temp.call_delivery('family_call_30min','2026-10-06T01:50:00Z')->>'ttl','600','delayed call TTL only remaining time');
SELECT is(pg_temp.call_delivery('family_call_30min','2026-10-06T01:50:00Z','2026-10-06T02:20:00Z'),NULL,'cannot restart call occurrence TTL');
SELECT ok(pg_temp.call_delivery('family_call_30min','2026-12-08T02:30:00Z','2026-12-08T03:00:00Z') IS NOT NULL,'winter Pacific clock stays 7pm');
CREATE FUNCTION pg_temp.winback() RETURNS jsonb LANGUAGE sql AS $$ SELECT dispatcher_job_delivery('winback',pg_temp.aid(1),NULL,now()+interval '1 hour') $$;
SELECT ok(pg_temp.winback() IS NOT NULL,'winback positive control');
UPDATE accounts SET daily_push_opt_in=false WHERE id=pg_temp.aid(1);
SELECT is(pg_temp.winback(),NULL,'winback optout drops');
UPDATE accounts SET daily_push_opt_in=true WHERE id=pg_temp.aid(1);
INSERT INTO checkins(account_id,mood,checkin_date) VALUES(pg_temp.aid(1),3,current_date);
SELECT is(pg_temp.winback(),NULL,'new checkin defeats stale winback snapshot');
DELETE FROM checkins WHERE account_id=pg_temp.aid(1);
UPDATE accounts SET last_winback_at=now() WHERE id=pg_temp.aid(1);
SELECT is(pg_temp.winback(),NULL,'already delivered winback cooldown honored');
SELECT is((SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE '%dispatcher%' AND has_function_privilege('anon',p.oid,'EXECUTE')),0,'no dispatcher function anonymously exposed');
-- All kinds require a live claim, not just an event that still exists.
UPDATE push_outbox SET processing_at=now()-interval '6 minutes' WHERE id=(SELECT id FROM work WHERE kind='group');
SELECT is(pg_temp.delivery(id),NULL,'expired claim cannot deliver otherwise live group') FROM work WHERE kind='group';
UPDATE push_outbox SET processing_at=now() WHERE id=(SELECT id FROM work WHERE kind='group');
INSERT INTO work SELECT 'foreign-practice',pg_temp.enqueue('practice_incoming',pg_temp.aid(3),
 jsonb_build_object('event_id','dd700000-0000-0000-0000-000000000001','expires_at',now()+interval '30 minutes'));
SELECT is(pg_temp.delivery(id),NULL,'practice event cannot be delivered to different account') FROM work WHERE kind='foreign-practice';
-- Community is not a paid-only feature. Author access survives membership loss.
UPDATE community_posts SET status='visible' WHERE id='dd900000-0000-0000-0000-000000000001';
UPDATE entitlements SET expires_at=now()-interval '1 second' WHERE account_id=pg_temp.aid(1);
SELECT ok(pg_temp.delivery(id) IS NOT NULL,'free community author remains eligible') FROM work WHERE kind='community';
DELETE FROM community_supports WHERE post_id='dd900000-0000-0000-0000-000000000001';
SELECT is(pg_temp.delivery(id),NULL,'deleted support source stops stale community push') FROM work WHERE kind='community';
-- A paid one-off review is independently valid without a subscription.
UPDATE video_sessions SET status='scheduled',appointment_type='one_off_150',payment_status='paid',version=version+1
WHERE id='dd800000-0000-0000-0000-000000000001';
INSERT INTO work SELECT 'one-off',pg_temp.enqueue('premier_video_reminder',pg_temp.aid(1),'{"session_id":"dd800000-0000-0000-0000-000000000001"}');
SELECT ok(pg_temp.delivery(id) IS NOT NULL,'paid one-off reminder does not invent a subscription requirement') FROM work WHERE kind='one-off';
UPDATE video_sessions SET payment_status='refunded' WHERE id='dd800000-0000-0000-0000-000000000001';
SELECT is(pg_temp.delivery(id),NULL,'refunded one-off loses active session access') FROM work WHERE kind='one-off';
-- force is a service-only preview, not a bypass for consent or RSVP.
SELECT ok(dispatcher_job_delivery('family_call_30min',pg_temp.aid(1),family_squares_session_id(),
 '2026-10-06T02:00:00Z','2026-10-01T20:00:00Z',true) IS NOT NULL,'operator force previews next actual call outside cron hour');
SELECT is(dispatcher_job_delivery('family_call_30min',pg_temp.aid(1),family_squares_session_id(),
 '2026-10-06T02:00:00Z','2026-10-01T20:00:00Z',false),NULL,'normal job cannot preview outside call day');
UPDATE accounts SET family_call_reminders=false WHERE id=pg_temp.aid(1);
SELECT is(dispatcher_job_delivery('family_call_30min',pg_temp.aid(1),family_squares_session_id(),
 '2026-10-06T02:00:00Z','2026-10-01T20:00:00Z',true),NULL,'force cannot bypass family call optout');
UPDATE accounts SET family_call_reminders=true WHERE id=pg_temp.aid(1);
SELECT ok(dispatcher_job_delivery('family_call_30min',pg_temp.aid(1),family_squares_session_id(),
 '2026-11-03T03:00:00Z','2026-10-27T02:01:00Z',true) IS NOT NULL,'force next occurrence crosses DST at Pacific 7pm');
-- Exercise the real reminder producer, not only hand-built outbox fixtures.
UPDATE entitlements SET expires_at=now()+interval '30 days' WHERE account_id=pg_temp.aid(1);
UPDATE video_sessions SET payment_status='paid',scheduled_for=now()+interval '1 hour',version=version+1
WHERE id='dd800000-0000-0000-0000-000000000001';
SELECT is(enqueue_premier_video_reminders(),2,'actual reminder producer creates member and assigned coach work');
UPDATE push_outbox SET processing_at=now(),processing_token='dd600000-0000-0000-0000-000000000001'
WHERE idempotency_key LIKE 'video:dd800000-0000-0000-0000-000000000001:%:reminder:%';
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE idempotency_key LIKE 'video:dd800000-0000-0000-0000-000000000001:%:reminder:%'
 AND pg_temp.delivery(id) IS NOT NULL),2,'actual reminder snapshots are deliverable with current access');
UPDATE video_sessions SET assigned_coach_id=pg_temp.aid(2) WHERE id='dd800000-0000-0000-0000-000000000001';
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE idempotency_key LIKE 'video:dd800000-0000-0000-0000-000000000001:%:reminder:%'
 AND pg_temp.delivery(id) IS NOT NULL),0,'actual queued reminders invalidated on reassignment');
SELECT * FROM finish();
ROLLBACK;
