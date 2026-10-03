BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

-- ── Privileges: service role only ───────────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon','public.service_family_squares_attendees(timestamptz)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.service_family_squares_attendees(timestamptz)','EXECUTE')
  AND has_function_privilege('service_role','public.service_family_squares_attendees(timestamptz)','EXECUTE'),
  'attendee export is service-role only');
SELECT ok(NOT has_function_privilege('anon','public.service_family_squares_push_reachable(text[],timestamptz)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.service_family_squares_push_reachable(text[],timestamptz)','EXECUTE')
  AND has_function_privilege('service_role','public.service_family_squares_push_reachable(text[],timestamptz)','EXECUTE'),
  'push-reachable lookup is service-role only');
SELECT ok(NOT has_function_privilege('anon','public.service_membership_export(uuid,integer)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.service_membership_export(uuid,integer)','EXECUTE')
  AND has_function_privilege('service_role','public.service_membership_export(uuid,integer)','EXECUTE'),
  'membership export is service-role only');
SELECT ok(NOT has_function_privilege('anon','public.service_membership_import(jsonb,boolean,boolean)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.service_membership_import(jsonb,boolean,boolean)','EXECUTE')
  AND has_function_privilege('service_role','public.service_membership_import(jsonb,boolean,boolean)','EXECUTE'),
  'membership import is service-role only');

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Isolate from any existing rows; everything rolls back at the end.
DELETE FROM session_rsvps;
DELETE FROM session_questions;
DELETE FROM entitlements;
INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,aud,role) VALUES
 ('31000000-0000-0000-0000-000000000001','Going@Example.com',now(),'{}','{"first_name":"Ana"}','authenticated','authenticated'),
 ('31000000-0000-0000-0000-000000000002','declined@example.com',now(),'{}','{}','authenticated','authenticated'),
 ('31000000-0000-0000-0000-000000000003','asker@example.com',now(),'{}','{"first_name":"   "}','authenticated','authenticated'),
 ('31000000-0000-0000-0000-000000000004','stale@example.com',now(),'{}','{"first_name":"Sam"}','authenticated','authenticated'),
 ('31000000-0000-0000-0000-000000000005','unverified@example.com',NULL,'{}','{"first_name":"Uma"}','authenticated','authenticated'),
 ('31000000-0000-0000-0000-000000000006','reminders@example.com',now(),'{}','{"first_name":"Rae"}','authenticated','authenticated'),
 ('31000000-0000-0000-0000-000000000007','notoken@example.com',now(),'{}','{"first_name":"Nia"}','authenticated','authenticated');
UPDATE accounts SET id=('41000000-0000-0000-0000-'||right(user_id::text,12))::uuid
 WHERE user_id::text LIKE '31000000-0000-0000-0000-00000000000%';
UPDATE accounts SET push_token='ExponentPushToken[bridge-'||right(id::text,1)||']', family_call_reminders=true
 WHERE id IN ('41000000-0000-0000-0000-000000000001','41000000-0000-0000-0000-000000000006');
UPDATE accounts SET push_token='ExponentPushToken[bridge-'||right(id::text,1)||']', family_call_reminders=false
 WHERE id IN ('41000000-0000-0000-0000-000000000003','41000000-0000-0000-0000-000000000004','41000000-0000-0000-0000-000000000005');
UPDATE accounts SET push_token=NULL, family_call_reminders=true
 WHERE id IN ('41000000-0000-0000-0000-000000000002','41000000-0000-0000-0000-000000000007');

INSERT INTO session_rsvps(session_id,account_id,status,created_at) VALUES
 (public.family_squares_session_id(),'41000000-0000-0000-0000-000000000001','going',now()-interval '2 hours'),
 (public.family_squares_session_id(),'41000000-0000-0000-0000-000000000002','declined',now()-interval '2 hours'),
 (public.family_squares_session_id(),'41000000-0000-0000-0000-000000000004','going',now()-interval '8 days'),
 (public.family_squares_session_id(),'41000000-0000-0000-0000-000000000005','going',now()-interval '2 hours'),
 (public.family_squares_session_id(),'41000000-0000-0000-0000-000000000007','going',now()-interval '2 hours');
INSERT INTO session_questions(session_id,account_id,question,created_at)
SELECT public.family_squares_session_id(),'41000000-0000-0000-0000-000000000001','  question '||i||E'\n',now()-interval '6 hours'+i*interval '1 minute'
FROM generate_series(1,6) i;
INSERT INTO session_questions(session_id,account_id,question,created_at) VALUES
 (public.family_squares_session_id(),'41000000-0000-0000-0000-000000000001','last week''s question',now()-interval '8 days'),
 (public.family_squares_session_id(),'41000000-0000-0000-0000-000000000001','   ',now()-interval '1 hour'),
 (public.family_squares_session_id(),'41000000-0000-0000-0000-000000000003','How do I start the conversation?',now()-interval '3 hours'),
 (public.family_squares_session_id(),'41000000-0000-0000-0000-000000000005','unverified question',now()-interval '3 hours');

-- ── C. Attendees ────────────────────────────────────────────────────────────
CREATE TEMP TABLE bridge_attendees AS
SELECT * FROM public.service_family_squares_attendees(now()-interval '1 day');
SELECT is(ARRAY(SELECT email FROM bridge_attendees ORDER BY email),
  ARRAY['asker@example.com','declined@example.com','going@example.com','notoken@example.com'],
  'verified RSVPs and askers since the last call; stale RSVPs and unverified emails never leave');
SELECT is((SELECT row(name,rsvp,questions,app_reminders)::text FROM bridge_attendees WHERE email='going@example.com'),
  row('Ana','going',ARRAY['question 2','question 3','question 4','question 5','question 6'],true)::text,
  'the newest five non-blank questions, trimmed, newest last; push + RSVP = app reminds');
SELECT is((SELECT row(name,rsvp,cardinality(questions),app_reminders)::text FROM bridge_attendees WHERE email='declined@example.com'),
  row('','declined',0,false)::text,
  'no first name falls back to the neutral name; no device = no app reminder');
SELECT is((SELECT row(name,rsvp,questions,app_reminders)::text FROM bridge_attendees WHERE email='asker@example.com'),
  row('',NULL::text,ARRAY['How do I start the conversation?'],false)::text,
  'a question alone counts (RSVP null); reminders off and no RSVP = not reminded by the app');
SELECT is((SELECT app_reminders FROM bridge_attendees WHERE email='notoken@example.com'), false,
  'RSVP without a device is not reminded by the app');
SELECT throws_ok($$SELECT * FROM public.service_family_squares_attendees(NULL)$$, '22023', 'invalid_since', 'a window start is required');

-- ── D. Push-reachable ───────────────────────────────────────────────────────
SELECT is(public.service_family_squares_push_reachable(
  ARRAY[' GOING@example.com','asker@example.com','stale@example.com','unverified@example.com',
        'reminders@example.com','notoken@example.com','declined@example.com','nobody@example.com',''],
  now()-interval '1 day'),
  ARRAY['going@example.com','reminders@example.com'],
  'device + (reminder on or RSVP this week); verified only; returned lower-cased');
UPDATE accounts SET family_call_reminders=false WHERE id='41000000-0000-0000-0000-000000000001';
UPDATE accounts SET push_token='ExponentPushToken[bridge-2]' WHERE id='41000000-0000-0000-0000-000000000002';
SELECT is(public.service_family_squares_push_reachable(
  ARRAY['going@example.com','declined@example.com','stale@example.com'], now()-interval '1 day'),
  ARRAY['declined@example.com','going@example.com'],
  'with reminders off, a going or declined RSVP this week still counts; last week''s does not');
SELECT is(public.service_family_squares_push_reachable(ARRAY[]::text[], now()), ARRAY[]::text[], 'empty in, empty out');
SELECT throws_ok($$SELECT public.service_family_squares_push_reachable(array_fill('a@x.com'::text, ARRAY[1001]), now())$$,
  '22023', 'too_many_emails', 'at most 1000 emails per call');

-- ── E1. Membership export ───────────────────────────────────────────────────
INSERT INTO entitlements(account_id,source,tier,expires_at,raw) VALUES
 ('41000000-0000-0000-0000-000000000001','revenuecat','essential',now()+interval '20 days',NULL),
 ('41000000-0000-0000-0000-000000000001','revenuecat','premium',now()+interval '10 days',NULL),
 ('41000000-0000-0000-0000-000000000002','web','essential',now()+interval '35 days','{"email":"declined@example.com"}'),
 ('41000000-0000-0000-0000-000000000003','scholarship','essential',NULL,'{"email":"asker@example.com","granted_by":"soberhelpline_website_membership"}'),
 ('41000000-0000-0000-0000-000000000004','org','org',NULL,NULL),
 ('41000000-0000-0000-0000-000000000004','revenuecat','essential',now()+interval '5 days',NULL),
 ('41000000-0000-0000-0000-000000000005','revenuecat','essential',now()+interval '5 days',NULL),
 ('41000000-0000-0000-0000-000000000006','scholarship','essential',NULL,NULL),
 ('41000000-0000-0000-0000-000000000007','revenuecat','essential',now()-interval '1 day',NULL);
SELECT results_eq(
  $$SELECT account_id,email,tier,expires_at FROM public.service_membership_export(NULL,1000)$$,
  $$VALUES ('41000000-0000-0000-0000-000000000001'::uuid,'going@example.com','premier',now()+interval '20 days'),
           ('41000000-0000-0000-0000-000000000004'::uuid,'stale@example.com','org',NULL::timestamptz),
           ('41000000-0000-0000-0000-000000000006'::uuid,'reminders@example.com','essential',NULL::timestamptz)$$,
  'app-origin paid access only: best tier, latest expiry (none wins); website grants, expired rows and unverified emails excluded');
SELECT results_eq(
  $$SELECT account_id FROM public.service_membership_export(NULL,2)$$,
  $$VALUES ('41000000-0000-0000-0000-000000000001'::uuid),('41000000-0000-0000-0000-000000000004'::uuid)$$,
  'the first page');
SELECT results_eq(
  $$SELECT account_id FROM public.service_membership_export('41000000-0000-0000-0000-000000000004',2)$$,
  $$VALUES ('41000000-0000-0000-0000-000000000006'::uuid)$$,
  'the next page starts after the cursor');

-- ── E2. Membership import ───────────────────────────────────────────────────
-- Isolate: only this section's website grants exist (rolled back at the end).
DELETE FROM entitlements WHERE source='scholarship' AND raw->>'granted_by'='soberhelpline_website_membership';
CREATE TEMP TABLE bridge_at AS SELECT now()+interval '60 days' AS x, now()+interval '90 days' AS y, now()+interval '30 days' AS z;
INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,aud,role) VALUES
 ('32000000-0000-0000-0000-000000000001','member1@example.com',now(),'{}','{}','authenticated','authenticated'),
 ('32000000-0000-0000-0000-000000000002','member2@example.com',now(),'{}','{}','authenticated','authenticated'),
 ('32000000-0000-0000-0000-000000000003','Member3@Example.com',now(),'{}','{}','authenticated','authenticated'),
 ('32000000-0000-0000-0000-000000000004','member4@example.com',now(),'{}','{}','authenticated','authenticated'),
 ('32000000-0000-0000-0000-000000000005','member5@example.com',NULL,'{}','{}','authenticated','authenticated'),
 ('32000000-0000-0000-0000-000000000006','member6@example.com',now(),'{}','{}','authenticated','authenticated');
UPDATE accounts SET id=('42000000-0000-0000-0000-'||right(user_id::text,12))::uuid
 WHERE user_id::text LIKE '32000000-0000-0000-0000-00000000000%';
INSERT INTO entitlements(id,account_id,source,tier,expires_at,raw,created_at) VALUES
 ('52000000-0000-0000-0000-000000000002','42000000-0000-0000-0000-000000000002','scholarship','essential',(SELECT x FROM bridge_at),
   '{"email":"member2@example.com","granted_by":"soberhelpline_website_membership"}',now()-interval '20 days'),
 ('52000000-0000-0000-0000-000000000003','42000000-0000-0000-0000-000000000003','scholarship','essential',(SELECT x FROM bridge_at),
   '{"granted_by":"soberhelpline_website_membership"}',now()-interval '20 days'),
 ('52000000-0000-0000-0000-000000000004','42000000-0000-0000-0000-000000000004','scholarship','essential',NULL,
   '{"granted_by":"soberhelpline_website_membership"}',now()-interval '20 days'),
 ('52000000-0000-0000-0000-000000000061','42000000-0000-0000-0000-000000000006','scholarship','essential',(SELECT x FROM bridge_at),
   '{"granted_by":"soberhelpline_website_membership"}',now()-interval '20 days'),
 ('52000000-0000-0000-0000-000000000062','42000000-0000-0000-0000-000000000006','scholarship','essential',(SELECT z FROM bridge_at),
   '{"granted_by":"soberhelpline_website_membership"}',now()-interval '10 days'),
 -- A staff scholarship is never touched.
 ('52000000-0000-0000-0000-000000000099','42000000-0000-0000-0000-000000000004','scholarship','essential',NULL,NULL,now());
CREATE TEMP TABLE bridge_members AS SELECT jsonb_build_array(
  jsonb_build_object('email','member1@example.com','expires_at',(SELECT x FROM bridge_at)),
  jsonb_build_object('email',' Member1@Example.com ','expires_at',NULL),
  jsonb_build_object('email','member2@example.com','expires_at',(SELECT x FROM bridge_at)),
  jsonb_build_object('email','member3@example.com','expires_at',(SELECT y FROM bridge_at)),
  jsonb_build_object('email','member5@example.com','expires_at',(SELECT x FROM bridge_at)),
  jsonb_build_object('email','member6@example.com','expires_at',(SELECT x FROM bridge_at)),
  jsonb_build_object('email','nobody@example.com','expires_at',(SELECT x FROM bridge_at))
) AS members;
CREATE TEMP TABLE bridge_before AS SELECT * FROM entitlements WHERE account_id::text LIKE '42000000-%';

SELECT is(public.service_membership_import((SELECT members FROM bridge_members), true, false) - 'current_grants',
  '{"dry_run":true,"matched":4,"granted":1,"updated":2,"revoked":1,"unmatched":2,"revocation_blocked":false,"revoke_candidates":1}'::jsonb,
  'dry run reports the plan');
SELECT results_eq('SELECT id,expires_at,raw FROM entitlements WHERE account_id::text LIKE ''42000000-%'' ORDER BY id',
  'SELECT id,expires_at,raw FROM bridge_before ORDER BY id', 'dry run changes nothing');

SELECT is(public.service_membership_import((SELECT members FROM bridge_members), false, false) - 'current_grants',
  '{"dry_run":false,"matched":4,"granted":1,"updated":2,"revoked":1,"unmatched":2,"revocation_blocked":false,"revoke_candidates":1}'::jsonb,
  'the import applies the same plan');
SELECT is((SELECT row(count(*),min(source),min(tier),bool_and(expires_at IS NULL),min(raw::text))::text FROM entitlements
  WHERE account_id='42000000-0000-0000-0000-000000000001'),
  row(1,'scholarship','essential',true,'{"granted_by": "soberhelpline_website_membership"}')::text,
  'a new member gets one website-granted Essential row (a duplicate email with no expiry wins)');
SELECT is((SELECT row(expires_at=(SELECT x FROM bridge_at), raw->>'email')::text FROM entitlements WHERE id='52000000-0000-0000-0000-000000000002'),
  row(true,'member2@example.com')::text, 'an unchanged member''s existing row is reused as is');
SELECT ok((SELECT expires_at=(SELECT y FROM bridge_at) FROM entitlements WHERE id='52000000-0000-0000-0000-000000000003'),
  'a new expiry is applied (login email matched case-insensitively)');
SELECT ok((SELECT expires_at<=now() FROM entitlements WHERE id='52000000-0000-0000-0000-000000000004'),
  'a member no longer on the list is revoked');
SELECT ok((SELECT expires_at IS NULL FROM entitlements WHERE id='52000000-0000-0000-0000-000000000099'),
  'a staff scholarship is untouched');
SELECT is((SELECT count(*)::int FROM entitlements WHERE account_id='42000000-0000-0000-0000-000000000006'
  AND raw->>'granted_by'='soberhelpline_website_membership' AND (expires_at IS NULL OR expires_at>now())), 1,
  'duplicate website grants collapse to one active row');
SELECT is((SELECT count(*)::int FROM entitlements WHERE account_id='42000000-0000-0000-0000-000000000005'), 0,
  'an unverified email gets nothing');

SELECT is(public.service_membership_import((SELECT members FROM bridge_members), false, false) - 'current_grants',
  '{"dry_run":false,"matched":4,"granted":0,"updated":0,"revoked":0,"unmatched":2,"revocation_blocked":false,"revoke_candidates":0}'::jsonb,
  'a repeat import is a no-op');

-- Mass-revocation guard: 12 current grants missing from the list (> 10 and > 25%).
INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,aud,role)
SELECT ('33000000-0000-0000-0000-0000000000'||lpad(i::text,2,'0'))::uuid,'bulk'||i||'@example.com',now(),'{}','{}','authenticated','authenticated'
FROM generate_series(1,12) i;
INSERT INTO entitlements(account_id,source,tier,expires_at,raw)
SELECT a.id,'scholarship','essential',NULL,'{"granted_by":"soberhelpline_website_membership"}'
FROM accounts a WHERE a.user_id::text LIKE '33000000-%';
SELECT is((public.service_membership_import((SELECT members FROM bridge_members), false, false)->>'revocation_blocked')::boolean, true,
  'revoking 12 of 16 website grants is blocked');
SELECT is((SELECT count(*)::int FROM entitlements e JOIN accounts a ON a.id=e.account_id
  WHERE a.user_id::text LIKE '33000000-%' AND e.expires_at IS NULL), 12, 'nothing was revoked while blocked');
SELECT is(public.service_membership_import((SELECT members FROM bridge_members), true, true)->>'revoked', '12',
  'a dry run with allow_mass_revoke reports what it would revoke');
SELECT is((SELECT count(*)::int FROM entitlements e JOIN accounts a ON a.id=e.account_id
  WHERE a.user_id::text LIKE '33000000-%' AND e.expires_at IS NULL), 12, 'still nothing revoked after the dry run');
SELECT is(public.service_membership_import((SELECT members FROM bridge_members), false, true)->>'revoked', '12',
  'allow_mass_revoke revokes');
SELECT is((SELECT count(*)::int FROM entitlements e JOIN accounts a ON a.id=e.account_id
  WHERE a.user_id::text LIKE '33000000-%' AND (e.expires_at IS NULL OR e.expires_at>now())), 0, 'all 12 revoked');

SELECT throws_ok($$SELECT public.service_membership_import('{}'::jsonb)$$, '22023', 'invalid_members', 'members must be an array');
SELECT throws_ok($$SELECT public.service_membership_import('[{"expires_at":null}]'::jsonb)$$, '22023', 'invalid_member', 'every member has an email');
SELECT throws_ok($$SELECT public.service_membership_import('[{"email":"a@x.com"}]'::jsonb)$$, '22023', 'invalid_member', 'expires_at must be given (or null)');
SELECT throws_ok($$SELECT public.service_membership_import('[{"email":"a@x.com","expires_at":"soon"}]'::jsonb)$$, '22023', 'invalid_member_expiry', 'expiry must be a timestamp');

SELECT * FROM finish();
ROLLBACK;
