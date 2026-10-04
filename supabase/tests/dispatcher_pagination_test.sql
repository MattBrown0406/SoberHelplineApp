BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();
SELECT ok(NOT has_function_privilege('anon','dispatcher_job_targets(text,boolean,uuid,timestamptz)','EXECUTE')
 AND NOT has_function_privilege('authenticated','dispatcher_job_targets(text,boolean,uuid,timestamptz)','EXECUTE')
 AND has_function_privilege('service_role','dispatcher_job_targets(text,boolean,uuid,timestamptz)','EXECUTE'), 'keyset discovery remains service only');
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role)
 SELECT ('98000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'sql-pagination-'||i||'@example.invalid','{}','{}','authenticated','authenticated'
 FROM generate_series(1,1002) i;
UPDATE accounts SET id=('99000000-0000-0000-0000-'||right(user_id::text,12))::uuid,
 push_token='ExponentPushToken['||user_id||']',family_call_reminders=true,daily_push_opt_in=true,created_at=now()-interval '10 days'
 WHERE user_id::text LIKE '98000000-0000-0000-0000-%';
UPDATE accounts SET family_call_reminders=false,daily_push_opt_in=false WHERE id='99000000-0000-0000-0000-000000001002';
-- Winbacks go out 9 AM–8 PM in the member's zone: use a fixed-offset zone where it is mid-afternoon now.
UPDATE accounts SET timezone=(SELECT CASE WHEN x=0 THEN 'Etc/GMT' WHEN x>0 THEN 'Etc/GMT+'||x ELSE 'Etc/GMT'||x END
 FROM (SELECT (((extract(hour FROM now() AT TIME ZONE 'UTC')::integer-14+12)%24+24)%24)-12 AS x) s)
 WHERE id::text LIKE '99000000-0000-0000-0000-%';
CREATE TEMP TABLE pages(job text,page integer,account_id uuid,expires_at timestamptz);
INSERT INTO session_rsvps(account_id,session_id,status) SELECT id,family_squares_session_id(),'going' FROM accounts WHERE id::text LIKE '99000000-0000-0000-0000-%';
INSERT INTO pages SELECT 'session_reminder',1,account_id,expires_at FROM dispatcher_job_targets('session_reminder',true,NULL,now());
INSERT INTO pages SELECT 'session_reminder',2,account_id,expires_at FROM dispatcher_job_targets('session_reminder',true,'99000000-0000-0000-0000-000000001000',now());
DELETE FROM session_rsvps WHERE account_id::text LIKE '99000000-0000-0000-0000-%';
INSERT INTO pages SELECT 'family_call_30min',1,account_id,expires_at FROM dispatcher_job_targets('family_call_30min',true,NULL,now());
INSERT INTO pages SELECT 'family_call_30min',2,account_id,expires_at FROM dispatcher_job_targets('family_call_30min',true,'99000000-0000-0000-0000-000000001000',now());
INSERT INTO pages SELECT 'winback',1,account_id,expires_at FROM dispatcher_job_targets('winback',true,NULL,now());
-- Simulate successful first-page cooldown: OFFSET would now skip account 1001.
UPDATE accounts SET last_winback_at=now() WHERE id IN (SELECT account_id FROM pages WHERE job='winback' AND page=1);
INSERT INTO pages SELECT 'winback',2,account_id,expires_at FROM dispatcher_job_targets('winback',true,'99000000-0000-0000-0000-000000001000',now());
SELECT is((SELECT count(*)::integer FROM pages p WHERE p.job=j AND page=1),1000,j||' first page bounded') FROM unnest(ARRAY['session_reminder','family_call_30min','winback']) j;
SELECT is((SELECT count(*)::integer FROM pages p WHERE p.job=j AND page=2),1,j||' eligible account 1001 discovered') FROM unnest(ARRAY['session_reminder','family_call_30min','winback']) j;
SELECT is((SELECT count(DISTINCT account_id)::integer FROM pages p WHERE p.job=j),1001,j||' no gaps or duplicates') FROM unnest(ARRAY['session_reminder','family_call_30min','winback']) j;
SELECT is((SELECT count(DISTINCT expires_at)::integer FROM pages p WHERE p.job=j),1,j||' original absolute deadline across pages') FROM unnest(ARRAY['session_reminder','family_call_30min','winback']) j;
SELECT is((SELECT count(*)::integer FROM dispatcher_job_targets(j,true,'99000000-0000-0000-0000-000000001001',now())),0,j||' exhausted page and consent control') FROM unnest(ARRAY['session_reminder','family_call_30min','winback']) j;
SELECT * FROM finish();
ROLLBACK;
