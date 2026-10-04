BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

-- pg_net only sends COMMITTED requests; this transaction always rolls back.

SELECT ok(NOT has_function_privilege('authenticated','public.dispatcher_winback_retry_targets(uuid,timestamptz)','EXECUTE')
  AND NOT has_function_privilege('anon','public.abandon_push_recipient(text,text,uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public._video_versions_payment_only(uuid,integer,integer)','EXECUTE')
  AND has_function_privilege('service_role','public.dispatcher_winback_retry_targets(uuid,timestamptz)','EXECUTE')
  AND has_function_privilege('service_role','public.abandon_push_recipient(text,text,uuid,uuid)','EXECUTE'),
  'new dispatcher helpers are service-role only');
SELECT ok(NOT has_column_privilege('authenticated','public.accounts','push_token_seen_at','UPDATE'),
  'members cannot mark their own device confirmed');

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role) VALUES
 ('a6000000-0000-0000-0000-000000000001','windows-owner@example.invalid','{}','{}','authenticated','authenticated'),
 ('a6000000-0000-0000-0000-000000000002','windows-member@example.invalid','{}','{}','authenticated','authenticated'),
 ('a6000000-0000-0000-0000-000000000003','windows-winback@example.invalid','{}','{}','authenticated','authenticated');
UPDATE accounts SET id=('a7000000-0000-0000-0000-'||right(user_id::text,12))::uuid
 WHERE user_id::text LIKE 'a6000000-0000-0000-0000-00000000000%';
UPDATE accounts SET push_token='ExponentPushToken[windows-'||right(id::text,1)||']', family_call_reminders=true,
  daily_push_opt_in=true, created_at='2026-09-01T00:00:00Z'
 WHERE id::text LIKE 'a7000000-0000-0000-0000-00000000000%';
INSERT INTO entitlements(account_id,source,tier,expires_at) VALUES
 ('a7000000-0000-0000-0000-000000000002','scholarship','essential',now()+interval '30 days');
INSERT INTO video_staff_roles(account_id,role,active) VALUES('a7000000-0000-0000-0000-000000000001','owner',true)
ON CONFLICT(account_id) DO UPDATE SET role=excluded.role,active=true;

-- ── 1. "New plan review request" survives the member paying ─────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a6000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SELECT request_plan_review_video_session(now()+interval '4 days','America/Chicago',60,'plan_review',NULL,'[]','{safetyPlan}'::text[],
  '{"schemaVersion":"1","sections":{"safetyPlan":{}}}'::jsonb,'I choose to share this plan. This is not an emergency service.','en','one_off_150');
RESET ROLE;
CREATE TEMP TABLE req AS
SELECT o.id, s.id AS session_id FROM push_outbox o JOIN video_sessions s ON s.id::text=o.metadata->>'session_id'
WHERE o.kind='admin_video_request' AND o.account_id='a7000000-0000-0000-0000-000000000001' AND s.account_id='a7000000-0000-0000-0000-000000000002';
GRANT SELECT ON req TO service_role;
UPDATE push_outbox SET processing_at=now(),processing_token='a8000000-0000-0000-0000-000000000001' WHERE id=(SELECT id FROM req);
CREATE FUNCTION pg_temp.req_delivery() RETURNS jsonb LANGUAGE sql AS $$
  SELECT dispatcher_outbox_delivery((SELECT id FROM req),'a8000000-0000-0000-0000-000000000001')
$$;
SELECT ok(pg_temp.req_delivery() IS NOT NULL, 'request push deliverable before payment');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT apply_plan_review_payment_event('windows.capture.0001',(SELECT session_id FROM req),'ORDER-WINDOWS','CAPTURE-WINDOWS','captured',15000,'USD');
RESET ROLE;
SELECT ok((SELECT version FROM video_sessions WHERE id=(SELECT session_id FROM req))
          > (SELECT (metadata->>'delivery_version')::integer FROM push_outbox WHERE id=(SELECT id FROM req)),
  'payment bumped the session version');
SELECT ok(pg_temp.req_delivery() IS NOT NULL, 'a payment-only version bump keeps the request push deliverable');

UPDATE video_sessions SET version=version+1 WHERE id=(SELECT session_id FROM req);
SELECT is(pg_temp.req_delivery(), NULL, 'any other change still makes the request push stale');
UPDATE video_sessions SET version=version-1 WHERE id=(SELECT session_id FROM req);
UPDATE video_sessions SET status='cancelled' WHERE id=(SELECT session_id FROM req);
SELECT is(pg_temp.req_delivery(), NULL, 'a cancelled request is never announced');
UPDATE video_sessions SET status='requested' WHERE id=(SELECT session_id FROM req);
SELECT ok(pg_temp.req_delivery() IS NOT NULL, 'control restored');

-- ── 2. Monday call reminder windows (DST-correct) ────────────────────────────
SELECT is(_family_call_jobs_due('2026-10-06T00:59:00Z'), ARRAY[]::text[], '5:59 PM PDT: nothing yet');
SELECT is(_family_call_jobs_due('2026-10-06T01:05:00Z'), ARRAY['session_reminder'], '6:05 PM PDT: "about an hour"');
SELECT is(_family_call_jobs_due('2026-10-06T01:20:00Z'), ARRAY[]::text[], '6:20 PM PDT: too late for "about an hour"');
SELECT is(_family_call_jobs_due('2026-10-06T01:35:00Z'), ARRAY['family_call_30min'], '6:35 PM PDT: "in 30 minutes"');
SELECT is(_family_call_jobs_due('2026-10-06T01:45:00Z'), ARRAY[]::text[], '6:45 PM PDT: too late for "in 30 minutes"');
SELECT is(_family_call_jobs_due('2026-12-08T02:05:00Z'), ARRAY['session_reminder'], 'winter: 6:05 PM PST');
SELECT is(_family_call_jobs_due('2026-12-08T01:05:00Z'), ARRAY[]::text[], 'winter: 5:05 PM PST is not the window');
SELECT is(_family_call_jobs_due('2026-10-07T01:05:00Z'), ARRAY[]::text[], 'Tuesday: nothing');

INSERT INTO session_rsvps(account_id,session_id,status) VALUES('a7000000-0000-0000-0000-000000000002',family_squares_session_id(),'going');
CREATE FUNCTION pg_temp.call(k text, at_time timestamptz, who uuid DEFAULT 'a7000000-0000-0000-0000-000000000002') RETURNS jsonb LANGUAGE sql AS $$
  SELECT dispatcher_job_delivery(k,who,family_squares_session_id(),'2026-10-06T02:00:00Z',at_time)
$$;
SELECT is(pg_temp.call('session_reminder','2026-10-06T01:05:00Z')->>'expires_at', '2026-10-06T01:30:00+00:00',
  '"about an hour" is shown only until 6:30 PM');
SELECT is(pg_temp.call('session_reminder','2026-10-06T01:16:00Z'), NULL, '"about an hour" is never sent after 6:15 PM');
SELECT is(pg_temp.call('family_call_30min','2026-10-06T01:39:00Z','a7000000-0000-0000-0000-000000000003')->>'expires_at',
  '2026-10-06T01:45:00+00:00', '"in 30 minutes" is shown only until 6:45 PM');
SELECT is(pg_temp.call('family_call_30min','2026-10-06T01:41:00Z','a7000000-0000-0000-0000-000000000003'), NULL,
  '"in 30 minutes" is never sent after 6:40 PM');
SELECT ok(dispatcher_job_delivery('session_reminder','a7000000-0000-0000-0000-000000000002',family_squares_session_id(),
  '2026-10-06T02:00:00Z','2026-10-06T01:50:00Z',true) IS NOT NULL, 'operator preview is not bound to the send window');

-- ── 3. Winback: her own daytime, failed reservations only ────────────────────
UPDATE accounts SET timezone='America/New_York' WHERE id='a7000000-0000-0000-0000-000000000003';
CREATE FUNCTION pg_temp.winback_at(at_time timestamptz) RETURNS jsonb LANGUAGE sql AS $$
  SELECT dispatcher_job_delivery('winback','a7000000-0000-0000-0000-000000000003',NULL,at_time+interval '24 hours',at_time)
$$;
SELECT is(pg_temp.winback_at('2026-10-06T12:00:00Z'), NULL, '8 AM in New York: too early');
SELECT is(pg_temp.winback_at('2026-10-06T13:30:00Z')->>'expires_at', '2026-10-07T00:30:00+00:00',
  '9:30 AM in New York: sent, shown no later than 8:30 PM her time');
SELECT is(pg_temp.winback_at('2026-10-07T00:10:00Z'), NULL, '8:10 PM in New York: too late');
UPDATE accounts SET timezone='America/Los_Angeles' WHERE id='a7000000-0000-0000-0000-000000000003';
SELECT ok(pg_temp.winback_at('2026-10-07T00:10:00Z') IS NOT NULL, '5:10 PM in Los Angeles at the same instant: sent');

-- A fixed-offset zone where it is mid-afternoon (or 3 AM) right now.
CREATE FUNCTION pg_temp.tz_at(local_hour integer) RETURNS text LANGUAGE sql AS $$
 SELECT CASE WHEN x=0 THEN 'Etc/GMT' WHEN x>0 THEN 'Etc/GMT+'||x ELSE 'Etc/GMT'||x END
 FROM (SELECT (((extract(hour FROM now() AT TIME ZONE 'UTC')::integer-local_hour+12)%24+24)%24)-12 AS x) s
$$;
UPDATE accounts SET timezone=pg_temp.tz_at(14) WHERE id='a7000000-0000-0000-0000-000000000003';
CREATE TEMP TABLE wb AS SELECT claim_dispatcher_job('winback','a7000000-0000-0000-0000-000000000003',NULL,now()+interval '24 hours') AS data;
SELECT ok((SELECT data->>'processing_token' IS NOT NULL FROM wb), 'winback reserved in her daytime');
SELECT ok(finish_push_recipient('winback','cooldown','a7000000-0000-0000-0000-000000000003',(SELECT (data->>'processing_token')::uuid FROM wb),false),
  'provider failure releases the reservation');
SELECT is(ARRAY(SELECT account_id FROM dispatcher_winback_retry_targets(NULL,now())), ARRAY['a7000000-0000-0000-0000-000000000003'::uuid],
  'only the failed reservation is retried');

SELECT vault.create_secret('synthetic-windows-key','SUPABASE_SERVICE_ROLE_KEY');
SELECT lives_ok($$SELECT retry_notification_deliveries()$$, 'sweep runs');
SELECT is((SELECT count(*)::integer FROM net.http_request_queue
           WHERE convert_from(body,'UTF8')::jsonb->>'job'='winback' AND (convert_from(body,'UTF8')::jsonb->>'retry')::boolean),
  1, 'the sweep asks for a retry of failed reservations only');

UPDATE accounts SET timezone=pg_temp.tz_at(3) WHERE id='a7000000-0000-0000-0000-000000000003';
SELECT is((SELECT count(*)::integer FROM dispatcher_winback_retry_targets(NULL,now())), 0, 'no retry in the middle of her night');
DELETE FROM net.http_request_queue WHERE convert_from(body,'UTF8')::jsonb->>'job'='winback';
SELECT lives_ok($$SELECT retry_notification_deliveries()$$, 'night sweep runs');
SELECT is((SELECT count(*)::integer FROM net.http_request_queue WHERE convert_from(body,'UTF8')::jsonb->>'job'='winback'), 0,
  'the night sweep sends nothing');
UPDATE accounts SET timezone=pg_temp.tz_at(14) WHERE id='a7000000-0000-0000-0000-000000000003';

UPDATE push_recipient_deliveries SET attempt_count=5 WHERE kind='winback' AND account_id='a7000000-0000-0000-0000-000000000003';
SELECT is((SELECT count(*)::integer FROM dispatcher_winback_retry_targets(NULL,now())), 0, 'retries stop after five attempts');
UPDATE push_recipient_deliveries SET attempt_count=1 WHERE kind='winback' AND account_id='a7000000-0000-0000-0000-000000000003';

UPDATE wb SET data=claim_dispatcher_job('winback','a7000000-0000-0000-0000-000000000003',NULL,now()+interval '24 hours');
SELECT ok(abandon_push_recipient('winback','cooldown','a7000000-0000-0000-0000-000000000003',(SELECT (data->>'processing_token')::uuid FROM wb)),
  'a DeviceNotRegistered failure is finished');
SELECT ok((SELECT sent_at IS NULL AND processing_token IS NULL AND expires_at<=now() FROM push_recipient_deliveries
           WHERE kind='winback' AND account_id='a7000000-0000-0000-0000-000000000003'), 'finished, not pending');
SELECT is((SELECT count(*)::integer FROM dispatcher_winback_retry_targets(NULL,now())), 0, 'a finished failure is never retried');
SELECT is(abandon_push_recipient('winback','cooldown','a7000000-0000-0000-0000-000000000003',gen_random_uuid()), false, 'wrong token cannot finish');
SELECT ok(claim_dispatcher_job('winback','a7000000-0000-0000-0000-000000000003',NULL,now()+interval '24 hours') IS NOT NULL,
  'a later cycle can still reach her (once she has a device again)');
SELECT is((SELECT attempt_count FROM push_recipient_deliveries WHERE kind='winback' AND account_id='a7000000-0000-0000-0000-000000000003'), 1,
  'a new cycle starts its attempt count over');

-- ── 4. A confirmed device ────────────────────────────────────────────────────
UPDATE accounts SET push_token=NULL WHERE id='a7000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a6000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SELECT ok(register_push_device('ExponentPushToken[windows-confirmed-123456]','en'), 'app registers its device');
SELECT throws_ok($$UPDATE accounts SET push_token_seen_at=now() WHERE id=my_account_id()$$, '42501', NULL, 'the confirmation cannot be forged');
RESET ROLE;
SELECT ok((SELECT push_token_seen_at>now()-interval '1 minute' FROM accounts WHERE id='a7000000-0000-0000-0000-000000000002'),
  'registration confirms the device');
UPDATE accounts SET push_token=NULL WHERE id='a7000000-0000-0000-0000-000000000002';
SELECT is((SELECT push_token_seen_at FROM accounts WHERE id='a7000000-0000-0000-0000-000000000002'), NULL::timestamptz,
  'a dead token clears the confirmation');

-- ── 5. A one-off plan review awaiting payment still hears from her coach ─────
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role) VALUES
 ('a6000000-0000-0000-0000-000000000010','windows-oneoff@example.invalid','{}','{}','authenticated','authenticated');
UPDATE accounts SET id='a7000000-0000-0000-0000-000000000010', push_token='ExponentPushToken[windows-oneoff]'
 WHERE user_id='a6000000-0000-0000-0000-000000000010';
INSERT INTO entitlements(account_id,source,tier,expires_at) VALUES
 ('a7000000-0000-0000-0000-000000000010','scholarship','essential',now()+interval '30 days');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a6000000-0000-0000-0000-000000000010","role":"authenticated"}',true);
SELECT request_plan_review_video_session(now()+interval '5 days','America/Chicago',60,'plan_review',NULL,'[]','{safetyPlan}'::text[],
  '{"schemaVersion":"1","sections":{"safetyPlan":{}}}'::jsonb,'I choose to share this plan. This is not an emergency service.','en','one_off_150');
RESET ROLE;
CREATE TEMP TABLE oneoff AS SELECT id FROM video_sessions WHERE account_id='a7000000-0000-0000-0000-000000000010';
GRANT SELECT ON oneoff TO authenticated, service_role;
SELECT is((SELECT payment_status FROM video_sessions WHERE id=(SELECT id FROM oneoff)), 'pending_payment',
  'an Essential member books a one-off before paying');
-- Newest queued push of this kind for her, claimed and checked now.
CREATE FUNCTION pg_temp.oneoff_push(k text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE rid uuid;
BEGIN
 SELECT o.id INTO rid FROM push_outbox o
 WHERE o.account_id='a7000000-0000-0000-0000-000000000010' AND o.kind=k
 ORDER BY (o.metadata->>'delivery_version')::integer DESC LIMIT 1;
 UPDATE push_outbox SET processing_at=now(),processing_token='a8000000-0000-0000-0000-000000000010' WHERE id=rid;
 RETURN dispatcher_outbox_delivery(rid,'a8000000-0000-0000-0000-000000000010');
END $$;
-- A fresh notice of any kind about her current session.
CREATE FUNCTION pg_temp.oneoff_fresh(k text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE rid uuid;
BEGIN
 INSERT INTO push_outbox(account_id,kind,title,body,metadata,processing_at,processing_token)
 VALUES('a7000000-0000-0000-0000-000000000010',k,'Synthetic','Synthetic',
   jsonb_build_object('session_id',(SELECT id FROM oneoff)),now(),'a8000000-0000-0000-0000-000000000011')
 RETURNING id INTO rid;
 RETURN dispatcher_outbox_delivery(rid,'a8000000-0000-0000-0000-000000000011');
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a6000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SELECT admin_request_plan_review_update((SELECT id FROM oneoff),'Please add your safety contacts.');
RESET ROLE;
SELECT ok(pg_temp.oneoff_push('member_plan_update_requested') IS NOT NULL,
  'awaiting payment: "plan update requested" reaches her');

SELECT set_config('test.oneoff_version',(SELECT version::text FROM video_sessions WHERE id=(SELECT id FROM oneoff)),true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a6000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SELECT coach_counteroffer_video_session((SELECT id FROM oneoff),current_setting('test.oneoff_version')::integer,
  date_trunc('hour',now())+interval '6 days','America/Chicago',60);
RESET ROLE;
SELECT ok(pg_temp.oneoff_push('member_video_counteroffer') IS NOT NULL,
  'awaiting payment: "new time proposed" reaches her');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT apply_plan_review_payment_event('windows.capture.0010',(SELECT id FROM oneoff),'ORDER-ONEOFF','CAPTURE-ONEOFF','captured',15000,'USD');
RESET ROLE;
SELECT is((SELECT payment_status FROM video_sessions WHERE id=(SELECT id FROM oneoff)), 'paid', 'she paid');
SELECT ok(pg_temp.oneoff_push('member_video_counteroffer') IS NOT NULL,
  'paid: "new time proposed" is still delivered (paying does not make it stale)');
UPDATE video_sessions SET version=version+1 WHERE id=(SELECT id FROM oneoff);
SELECT is(pg_temp.oneoff_push('member_video_counteroffer'), NULL, 'any other change still makes it stale');
UPDATE video_sessions SET version=version-1 WHERE id=(SELECT id FROM oneoff);
UPDATE video_sessions SET payment_status='refunded' WHERE id=(SELECT id FROM oneoff);
SELECT is(pg_temp.oneoff_push('member_video_counteroffer'), NULL, 'a refunded one-off gets no active-session notices');
UPDATE video_sessions SET payment_status='paid' WHERE id=(SELECT id FROM oneoff);

-- Every other active-session notice still needs a paid one-off.
UPDATE video_sessions SET status='scheduled', scheduled_for=date_trunc('hour',now())+interval '6 days',
  assigned_coach_id='a7000000-0000-0000-0000-000000000001'
 WHERE id=(SELECT id FROM oneoff);
UPDATE video_sessions SET payment_status='pending_payment' WHERE id=(SELECT id FROM oneoff);
SELECT is(pg_temp.oneoff_fresh('premier_video_reminder'), NULL, 'awaiting payment: no session reminder');
SELECT is(pg_temp.oneoff_fresh('member_video_scheduled'), NULL, 'awaiting payment: no "session confirmed"');
SELECT ok(pg_temp.oneoff_fresh('member_plan_update_requested') IS NOT NULL, 'awaiting payment: plan update request still reaches her');
UPDATE video_sessions SET payment_status='paid' WHERE id=(SELECT id FROM oneoff);
SELECT ok(pg_temp.oneoff_fresh('premier_video_reminder') IS NOT NULL, 'paid: the session reminder is delivered');
UPDATE entitlements SET expires_at=now()-interval '1 second' WHERE account_id='a7000000-0000-0000-0000-000000000010';
SELECT ok(pg_temp.oneoff_fresh('member_video_counteroffer') IS NOT NULL, 'a paid one-off needs no membership');

-- ── 6. Support pushes: one a day per post, never from someone she blocked, ──
-- ──    only 9 AM–9 PM her time ─────────────────────────────────────────────
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role) VALUES
 ('a6000000-0000-0000-0000-000000000020','windows-author@example.invalid','{}','{}','authenticated','authenticated'),
 ('a6000000-0000-0000-0000-000000000021','windows-heart-1@example.invalid','{}','{}','authenticated','authenticated'),
 ('a6000000-0000-0000-0000-000000000022','windows-heart-2@example.invalid','{}','{}','authenticated','authenticated'),
 ('a6000000-0000-0000-0000-000000000023','windows-heart-blocked@example.invalid','{}','{}','authenticated','authenticated');
UPDATE accounts SET id=('a7000000-0000-0000-0000-'||right(user_id::text,12))::uuid,
  push_token='ExponentPushToken[windows-heart-'||right(user_id::text,2)||']'
 WHERE user_id::text LIKE 'a6000000-0000-0000-0000-00000000002%';
UPDATE accounts SET timezone=pg_temp.tz_at(14), locale='en' WHERE id='a7000000-0000-0000-0000-000000000020';
INSERT INTO community_posts(id,account_id,body,status) VALUES
 ('a9000000-0000-0000-0000-000000000001','a7000000-0000-0000-0000-000000000020','Synthetic one','visible'),
 ('a9000000-0000-0000-0000-000000000002','a7000000-0000-0000-0000-000000000020','Synthetic two','visible'),
 ('a9000000-0000-0000-0000-000000000003','a7000000-0000-0000-0000-000000000020','Synthetic three','visible'),
 ('a9000000-0000-0000-0000-000000000004','a7000000-0000-0000-0000-000000000020','Synthetic four','visible');
INSERT INTO member_blocks(blocker_account_id,blocked_account_id)
VALUES('a7000000-0000-0000-0000-000000000020','a7000000-0000-0000-0000-000000000023');
CREATE FUNCTION pg_temp.heart_pushes(post text) RETURNS integer LANGUAGE sql AS $$
 SELECT count(*)::integer FROM push_outbox
 WHERE kind='community_support' AND account_id='a7000000-0000-0000-0000-000000000020' AND metadata->>'post_id'=post
$$;
CREATE FUNCTION pg_temp.author_local(t timestamptz) RETURNS timestamp LANGUAGE sql AS $$
 SELECT t AT TIME ZONE (SELECT timezone FROM accounts WHERE id='a7000000-0000-0000-0000-000000000020')
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a6000000-0000-0000-0000-000000000021","role":"authenticated"}',true);
SELECT is(support_community_post('a9000000-0000-0000-0000-000000000001'), 1, 'first heart is counted');
SELECT set_config('request.jwt.claims','{"sub":"a6000000-0000-0000-0000-000000000022","role":"authenticated"}',true);
SELECT is(support_community_post('a9000000-0000-0000-0000-000000000001'), 2, 'second heart is counted');
SELECT set_config('request.jwt.claims','{"sub":"a6000000-0000-0000-0000-000000000023","role":"authenticated"}',true);
SELECT is(support_community_post('a9000000-0000-0000-0000-000000000002'), 1, 'a heart from someone she blocked is still counted, without error');
RESET ROLE;
SELECT is(pg_temp.heart_pushes('a9000000-0000-0000-0000-000000000001'), 1, 'two hearts on one post in a day: one push');
SELECT ok((SELECT o.idempotency_key='community-support:a9000000-0000-0000-0000-000000000001:'||(pg_temp.author_local(now()))::date::text
             AND o.scheduled_for=now()
             AND pg_temp.author_local(o.expires_at)=(pg_temp.author_local(now()))::date+time '21:00'
           FROM push_outbox o WHERE o.kind='community_support' AND o.metadata->>'post_id'='a9000000-0000-0000-0000-000000000001'),
  'daytime heart: sent now, keyed to her day, shown until 9 PM her time');
SELECT is(pg_temp.heart_pushes('a9000000-0000-0000-0000-000000000002'), 0, 'no push for a supporter she blocked');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a6000000-0000-0000-0000-000000000021","role":"authenticated"}',true);
SELECT is(support_community_post('a9000000-0000-0000-0000-000000000002'), 2, 'another member supports the same post');
RESET ROLE;
SELECT is(pg_temp.heart_pushes('a9000000-0000-0000-0000-000000000002'), 1, 'a supporter she has not blocked does reach her');

-- At 3 AM her time the heart waits for 9 AM; at 10 PM, for 9 AM tomorrow.
UPDATE accounts SET timezone=pg_temp.tz_at(3) WHERE id='a7000000-0000-0000-0000-000000000020';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a6000000-0000-0000-0000-000000000021","role":"authenticated"}',true);
SELECT is(support_community_post('a9000000-0000-0000-0000-000000000003'), 1, 'a heart at night is counted');
RESET ROLE;
SELECT ok((SELECT o.scheduled_for>now()
             AND pg_temp.author_local(o.scheduled_for)=(pg_temp.author_local(now()))::date+time '09:00'
             AND pg_temp.author_local(o.expires_at)=(pg_temp.author_local(now()))::date+time '21:00'
             AND o.idempotency_key LIKE '%:'||(pg_temp.author_local(now()))::date::text
           FROM push_outbox o WHERE o.kind='community_support' AND o.metadata->>'post_id'='a9000000-0000-0000-0000-000000000003'),
  '3 AM her time: queued for 9 AM, shown until 9 PM');
UPDATE accounts SET timezone=pg_temp.tz_at(22) WHERE id='a7000000-0000-0000-0000-000000000020';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"a6000000-0000-0000-0000-000000000021","role":"authenticated"}',true);
SELECT is(support_community_post('a9000000-0000-0000-0000-000000000004'), 1, 'a heart late at night is counted');
RESET ROLE;
SELECT ok((SELECT pg_temp.author_local(o.scheduled_for)=(pg_temp.author_local(now()))::date+1+time '09:00'
             AND o.idempotency_key LIKE '%:'||((pg_temp.author_local(now()))::date+1)::text
           FROM push_outbox o WHERE o.kind='community_support' AND o.metadata->>'post_id'='a9000000-0000-0000-0000-000000000004'),
  '10 PM her time: queued for 9 AM tomorrow');

-- The dispatcher re-checks her clock and her blocks at delivery.
UPDATE accounts SET timezone=pg_temp.tz_at(14) WHERE id='a7000000-0000-0000-0000-000000000020';
UPDATE push_outbox SET processing_at=now(),processing_token='a8000000-0000-0000-0000-000000000020'
 WHERE kind='community_support' AND metadata->>'post_id'='a9000000-0000-0000-0000-000000000001';
CREATE FUNCTION pg_temp.heart_delivery() RETURNS jsonb LANGUAGE sql AS $$
 SELECT dispatcher_outbox_delivery(
   (SELECT id FROM push_outbox WHERE kind='community_support' AND metadata->>'post_id'='a9000000-0000-0000-0000-000000000001'
      AND idempotency_key IS NOT NULL),
   'a8000000-0000-0000-0000-000000000020')
$$;
SELECT is((pg_temp.heart_delivery()->>'expires_at')::timestamptz,
  ((pg_temp.author_local(now()))::date+time '21:00') AT TIME ZONE pg_temp.tz_at(14),
  '2 PM her time: delivered, shown until 9 PM');
UPDATE accounts SET timezone=pg_temp.tz_at(22) WHERE id='a7000000-0000-0000-0000-000000000020';
SELECT is(pg_temp.heart_delivery(), NULL, '10 PM her time: not delivered');
UPDATE accounts SET timezone=pg_temp.tz_at(7) WHERE id='a7000000-0000-0000-0000-000000000020';
SELECT is(pg_temp.heart_delivery(), NULL, '7 AM her time: not delivered');
UPDATE accounts SET timezone=pg_temp.tz_at(14) WHERE id='a7000000-0000-0000-0000-000000000020';
INSERT INTO member_blocks(blocker_account_id,blocked_account_id) VALUES
 ('a7000000-0000-0000-0000-000000000020','a7000000-0000-0000-0000-000000000021'),
 ('a7000000-0000-0000-0000-000000000020','a7000000-0000-0000-0000-000000000022');
SELECT is(pg_temp.heart_delivery(), NULL, 'every supporter since blocked: not delivered');
DELETE FROM member_blocks WHERE blocker_account_id='a7000000-0000-0000-0000-000000000020'
  AND blocked_account_id='a7000000-0000-0000-0000-000000000022';
SELECT ok(pg_temp.heart_delivery() IS NOT NULL, 'one supporter she has not blocked: delivered');
-- A heart queued before this release (no expiry) is still never shown after 9 PM.
INSERT INTO push_outbox(account_id,kind,title,body,metadata,processing_at,processing_token)
VALUES('a7000000-0000-0000-0000-000000000020','community_support','Synthetic','Synthetic',
  '{"kind":"community_support","post_id":"a9000000-0000-0000-0000-000000000001"}',now(),'a8000000-0000-0000-0000-000000000021');
SELECT is((dispatcher_outbox_delivery((SELECT id FROM push_outbox WHERE kind='community_support' AND idempotency_key IS NULL),
  'a8000000-0000-0000-0000-000000000021')->>'expires_at')::timestamptz,
  ((pg_temp.author_local(now()))::date+time '21:00') AT TIME ZONE pg_temp.tz_at(14),
  'legacy heart without expiry: shown until 9 PM her time');

-- ── 7. A post with the 988/911 note reaches Matt unreported ──────────────────
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role) VALUES
 ('a6000000-0000-0000-0000-000000000030','matt@soberhelpline.com','{}','{}','authenticated','authenticated');
UPDATE accounts SET id='a7000000-0000-0000-0000-000000000030', push_token='ExponentPushToken[windows-admin]'
 WHERE user_id='a6000000-0000-0000-0000-000000000030';
INSERT INTO community_posts(id,account_id,body,status) VALUES
 ('a9000000-0000-0000-0000-000000000005','a7000000-0000-0000-0000-000000000020','Synthetic','visible');
CREATE FUNCTION pg_temp.report_push(who uuid, m jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE rid uuid;
BEGIN
 INSERT INTO push_outbox(account_id,kind,title,body,metadata,processing_at,processing_token)
 VALUES(who,'admin_community_report','Synthetic','Synthetic',m,now(),'a8000000-0000-0000-0000-000000000030')
 RETURNING id INTO rid;
 RETURN dispatcher_outbox_delivery(rid,'a8000000-0000-0000-0000-000000000030');
END $$;
SELECT ok(pg_temp.report_push('a7000000-0000-0000-0000-000000000030',
  '{"kind":"admin_community_report","post_id":"a9000000-0000-0000-0000-000000000005","reason":"crisis"}') IS NOT NULL,
  'crisis note, no report: delivered to the admin');
SELECT is(pg_temp.report_push('a7000000-0000-0000-0000-000000000020',
  '{"kind":"admin_community_report","post_id":"a9000000-0000-0000-0000-000000000005","reason":"crisis"}'), NULL,
  'crisis note: never delivered to a non-admin');
SELECT is(pg_temp.report_push('a7000000-0000-0000-0000-000000000030',
  '{"kind":"admin_community_report","post_id":"a9000000-0000-0000-0000-000000000005"}'), NULL,
  'a report alert with no open report is still not delivered');
INSERT INTO community_reports(post_id,reporter_account_id)
VALUES('a9000000-0000-0000-0000-000000000005','a7000000-0000-0000-0000-000000000021');
SELECT ok(pg_temp.report_push('a7000000-0000-0000-0000-000000000030',
  '{"kind":"admin_community_report","post_id":"a9000000-0000-0000-0000-000000000005"}') IS NOT NULL,
  'an open report: delivered');
UPDATE community_posts SET status='removed' WHERE id='a9000000-0000-0000-0000-000000000005';
SELECT is(pg_temp.report_push('a7000000-0000-0000-0000-000000000030',
  '{"kind":"admin_community_report","post_id":"a9000000-0000-0000-0000-000000000005","reason":"crisis"}'), NULL,
  'a removed post needs no check');

SELECT * FROM finish();
ROLLBACK;
