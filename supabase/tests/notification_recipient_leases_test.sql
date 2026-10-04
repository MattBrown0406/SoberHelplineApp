BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role)
VALUES('92000000-0000-0000-0000-000000000001','lease@example.invalid','{}','{}','authenticated','authenticated');
UPDATE accounts SET id='93000000-0000-0000-0000-000000000001',push_token='current-token',daily_push_opt_in=true,
 family_call_reminders=true,created_at=now()-interval '10 days',
 -- Winbacks go out 9 AM–8 PM in her zone: a fixed-offset zone where it is mid-afternoon now.
 timezone=(SELECT CASE WHEN x=0 THEN 'Etc/GMT' WHEN x>0 THEN 'Etc/GMT+'||x ELSE 'Etc/GMT'||x END
   FROM (SELECT (((extract(hour FROM now() AT TIME ZONE 'UTC')::integer-14+12)%24+24)%24)-12 AS x) s)
 WHERE user_id='92000000-0000-0000-0000-000000000001';
CREATE TEMP TABLE leases (token uuid, old_token uuid, deadline timestamptz);
INSERT INTO leases SELECT claim_push_recipient('family_backup','event','93000000-0000-0000-0000-000000000001',now()+interval '10 minutes'),NULL,now()+interval '10 minutes';
SELECT ok((SELECT token IS NOT NULL FROM leases),'first recipient lease acquired');
SELECT is(claim_push_recipient('family_backup','event','93000000-0000-0000-0000-000000000001',now()+interval '10 minutes'),NULL::uuid,'overlapping claim denied');
SELECT is(finish_push_recipient('family_backup','event','93000000-0000-0000-0000-000000000001',gen_random_uuid(),true),false,'wrong token cannot mark accepted');
SELECT ok(finish_push_recipient('family_backup','event','93000000-0000-0000-0000-000000000001',(SELECT token FROM leases),false),'lookup or provider failure releases lease');
UPDATE leases SET old_token=token,token=claim_push_recipient('family_backup','event','93000000-0000-0000-0000-000000000001',now()+interval '20 minutes');
SELECT ok((SELECT token IS NOT NULL AND token<>old_token FROM leases),'retry gets distinct token');
SELECT is((SELECT expires_at FROM push_recipient_deliveries WHERE kind='family_backup'),(SELECT deadline FROM leases),'retry never extends deadline');
SELECT is(finish_push_recipient('family_backup','event','93000000-0000-0000-0000-000000000001',(SELECT old_token FROM leases),true),false,'stale completion fenced');
SELECT ok(finish_push_recipient('family_backup','event','93000000-0000-0000-0000-000000000001',(SELECT token FROM leases),true),'accepted recipient acknowledged');
SELECT is(claim_push_recipient('family_backup','event','93000000-0000-0000-0000-000000000001',now()+interval '10 minutes'),NULL::uuid,'accepted recipient never resent');
SELECT ok(claim_push_recipient('family_backup','another-event','93000000-0000-0000-0000-000000000001',now()+interval '10 minutes') IS NOT NULL,'independent event unaffected');
UPDATE push_recipient_deliveries SET processing_at=now()-interval '6 minutes' WHERE event_key='another-event';
SELECT ok(claim_push_recipient('family_backup','another-event','93000000-0000-0000-0000-000000000001',now()+interval '10 minutes') IS NOT NULL,'abandoned lease recoverable');
SELECT is(claim_push_recipient('family_backup','expired','93000000-0000-0000-0000-000000000001',now()-interval '1 second'),NULL::uuid,'expired work cannot be claimed');
CREATE TEMP TABLE job_lease AS SELECT claim_dispatcher_job('winback','93000000-0000-0000-0000-000000000001',NULL,now()+interval '24 hours') data;
SELECT ok((SELECT data->>'processing_token' IS NOT NULL FROM job_lease),'winback account reserved');
SELECT ok(finish_push_recipient('winback','cooldown','93000000-0000-0000-0000-000000000001',(SELECT (data->>'processing_token')::uuid FROM job_lease),false),'failed winback releases lease');
UPDATE job_lease SET data=claim_dispatcher_job('winback','93000000-0000-0000-0000-000000000001',NULL,now()+interval '25 hours');
SELECT is((SELECT expires_at FROM push_recipient_deliveries WHERE kind='winback'),now()+interval '24 hours','winback retry keeps the immutable original deadline');
SELECT ok((SELECT (data->>'expires_at')::timestamptz<=now()+interval '24 hours' FROM job_lease),'winback retry is shown no later than that deadline (and not after 8:30 PM her time)');
SELECT is(claim_dispatcher_job('winback','93000000-0000-0000-0000-000000000001',NULL,now()+interval '24 hours'),NULL::jsonb,'winback overlap denied despite different deadline');
SELECT ok(finish_push_recipient('winback','cooldown','93000000-0000-0000-0000-000000000001',(SELECT (data->>'processing_token')::uuid FROM job_lease),true),'winback ack accepted');
SELECT ok((SELECT last_winback_at IS NOT NULL FROM accounts WHERE id='93000000-0000-0000-0000-000000000001'),'winback cooldown atomically recorded');
SELECT is(claim_dispatcher_job('winback','93000000-0000-0000-0000-000000000001',NULL,now()+interval '24 hours'),NULL::jsonb,'cooldown denies replay');
UPDATE accounts SET last_winback_at=now()-interval '8 days' WHERE id='93000000-0000-0000-0000-000000000001';
UPDATE push_recipient_deliveries SET sent_at=now()-interval '8 days',expires_at=now()-interval '7 days' WHERE kind='winback';
SELECT ok(claim_dispatcher_job('winback','93000000-0000-0000-0000-000000000001',NULL,now()+interval '24 hours') IS NOT NULL,'new winback cycle after cooldown');
UPDATE push_recipient_deliveries SET sent_at=NULL,processing_token=NULL,processing_at=NULL,expires_at=now()-interval '1 second' WHERE kind='winback';
SELECT ok(claim_dispatcher_job('winback','93000000-0000-0000-0000-000000000001',NULL,now()+interval '24 hours') IS NOT NULL,'expired failed winback does not suppress all future cycles');
CREATE TEMP TABLE occurrence AS SELECT session_id,expires_at FROM dispatcher_job_targets('family_call_30min',true) WHERE account_id='93000000-0000-0000-0000-000000000001';
UPDATE job_lease SET data=claim_dispatcher_job('family_call_30min','93000000-0000-0000-0000-000000000001',(SELECT session_id FROM occurrence),(SELECT expires_at FROM occurrence),true);
SELECT ok((SELECT data IS NOT NULL FROM job_lease),'force preview retains eligibility');
SELECT is((SELECT data->>'reservation_kind' FROM job_lease),'preview_family_call_30min','force has separate namespace');
SELECT is(claim_dispatcher_job('family_call_30min','93000000-0000-0000-0000-000000000001',(SELECT session_id FROM occurrence),(SELECT expires_at FROM occurrence),true),NULL::jsonb,'concurrent force preview deduped');
SELECT ok(finish_push_recipient('preview_family_call_30min',(SELECT data->>'event_key' FROM job_lease),'93000000-0000-0000-0000-000000000001',(SELECT (data->>'processing_token')::uuid FROM job_lease),false),'failed preview released');
UPDATE accounts SET family_call_reminders=false WHERE id='93000000-0000-0000-0000-000000000001';
SELECT is(claim_dispatcher_job('family_call_30min','93000000-0000-0000-0000-000000000001',(SELECT session_id FROM occurrence),(SELECT expires_at FROM occurrence),true),NULL::jsonb,'retry rechecks consent');
UPDATE accounts SET family_call_reminders=true,push_token='rotated-token' WHERE id='93000000-0000-0000-0000-000000000001';
SELECT is(claim_dispatcher_job('family_call_30min','93000000-0000-0000-0000-000000000001',(SELECT session_id FROM occurrence),(SELECT expires_at FROM occurrence),true)->>'push_token','rotated-token','retry resolves current device');
SELECT ok(NOT has_table_privilege('authenticated','push_recipient_deliveries','SELECT'),'recipient ledger private');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid='push_recipient_deliveries'::regclass),'ledger RLS enabled');
SELECT ok(NOT has_function_privilege('authenticated','claim_push_recipient(text,text,uuid,timestamptz)','EXECUTE'),'client cannot reserve');
SELECT ok(NOT has_function_privilege('anon','finish_push_recipient(text,text,uuid,uuid,boolean)','EXECUTE'),'anon cannot acknowledge');
SELECT ok(has_function_privilege('service_role','claim_dispatcher_job(text,uuid,uuid,timestamptz,boolean)','EXECUTE'),'service can reserve jobs');
SELECT ok(NOT has_function_privilege('authenticated','retry_notification_deliveries()','EXECUTE'),'retry scheduler is service only');
SELECT is((SELECT count(*)::integer FROM cron.job WHERE jobname='shl-notification-retry' AND schedule='* * * * *'),1,'bounded retry sweep scheduled each minute');
-- pg_net only consumes COMMITTED requests. This transaction always rolls back;
-- no synthetic key or request can leave the isolated database.
SELECT lives_ok($$SELECT retry_notification_deliveries()$$,'missing service secret fails closed');
SELECT vault.create_secret('synthetic-test-key','SUPABASE_SERVICE_ROLE_KEY');
INSERT INTO family_spaces(id,name,created_by,invite_code) VALUES
 ('96000000-0000-0000-0000-000000000001','Lease test','93000000-0000-0000-0000-000000000001','E101-E102');
INSERT INTO shared_walls(id,family_space_id,text,proposed_by) VALUES
 ('97000000-0000-0000-0000-000000000001','96000000-0000-0000-0000-000000000001','Synthetic','93000000-0000-0000-0000-000000000001');
INSERT INTO wavering_events(id,shared_wall_id,account_id,shared_with_family) VALUES
 ('98000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000001',true),
 ('98000000-0000-0000-0000-000000000002','97000000-0000-0000-0000-000000000001','93000000-0000-0000-0000-000000000001',false);
UPDATE push_recipient_deliveries SET processing_token=NULL,processing_at=NULL WHERE kind='winback';
SELECT lives_ok($$SELECT retry_notification_deliveries()$$,'retry sweep queues original event and failed winback');
SELECT is((SELECT count(*)::integer FROM net.http_request_queue WHERE convert_from(body,'UTF8')::jsonb->>'wavering_event_id'='98000000-0000-0000-0000-000000000001'),1,'discovery failure before any recipient lease is retried from durable source');
SELECT is((SELECT count(*)::integer FROM net.http_request_queue WHERE convert_from(body,'UTF8')::jsonb->>'wavering_event_id'='98000000-0000-0000-0000-000000000002'),0,'private source is never queued');
SELECT is((SELECT count(*)::integer FROM net.http_request_queue WHERE convert_from(body,'UTF8')::jsonb->>'job'='winback'),1,'failed winback has an automatic retry path');
SELECT * FROM finish();
ROLLBACK;
