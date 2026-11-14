BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

-- ── Privileges: service role only ───────────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon','public.service_account_deletion_target(text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.service_account_deletion_target(text)','EXECUTE')
  AND has_function_privilege('service_role','public.service_account_deletion_target(text)','EXECUTE'),
  'deletion target lookup is service-role only');
SELECT ok(NOT has_function_privilege('anon','public.service_delete_account_for_website(uuid,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.service_delete_account_for_website(uuid,text)','EXECUTE')
  AND has_function_privilege('service_role','public.service_delete_account_for_website(uuid,text)','EXECUTE'),
  'bridge deletion is service-role only');

-- ── Fixtures ────────────────────────────────────────────────────────────────
INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,aud,role) VALUES
 ('51000000-0000-0000-0000-000000000001','Member@Example.com',now(),'{}','{}','authenticated','authenticated'),
 ('51000000-0000-0000-0000-000000000002','unverified-del@example.com',NULL,'{}','{}','authenticated','authenticated'),
 ('51000000-0000-0000-0000-000000000003','coach-del@example.com',now(),'{}','{}','authenticated','authenticated'),
 ('51000000-0000-0000-0000-000000000004','bystander-del@example.com',now(),'{}','{}','authenticated','authenticated'),
 ('51000000-0000-0000-0000-000000000005','matt@soberhelpline.com',now(),'{}','{}','authenticated','authenticated');
INSERT INTO video_staff_roles(account_id,role,active)
  SELECT id,'coach',true FROM accounts WHERE user_id='51000000-0000-0000-0000-000000000003';

-- ── Who would be deleted ────────────────────────────────────────────────────
SELECT is((SELECT user_id FROM service_account_deletion_target('  member@example.COM ')),
  '51000000-0000-0000-0000-000000000001'::uuid,
  'a verified account is found by email, ignoring capitals and spaces');
SELECT is((SELECT account_id FROM service_account_deletion_target('member@example.com')),
  (SELECT id FROM accounts WHERE user_id='51000000-0000-0000-0000-000000000001'),
  'its app account id comes back for the file purge');
SELECT is((SELECT protected FROM service_account_deletion_target('member@example.com')), false,
  'an ordinary member is not protected');
SELECT is((SELECT count(*)::integer FROM service_account_deletion_target('unverified-del@example.com')), 0,
  'an unverified email never matches');
SELECT is((SELECT count(*)::integer FROM service_account_deletion_target('nobody-del@example.com')), 0,
  'an unknown email matches nothing');
SELECT is((SELECT count(*)::integer FROM service_account_deletion_target(NULL)), 0,
  'a missing email matches nothing');
SELECT is((SELECT count(*)::integer FROM service_account_deletion_target('%@example.com')), 0,
  'wildcards are not patterns');
SELECT is((SELECT protected FROM service_account_deletion_target('coach-del@example.com')), true,
  'active video staff are protected');
SELECT is((SELECT protected FROM service_account_deletion_target('matt@soberhelpline.com')), true,
  'the owner''s admin email is protected');

-- ── Deleting ────────────────────────────────────────────────────────────────
SELECT is(service_delete_account_for_website('51000000-0000-0000-0000-000000000004','member@example.com'), 'not_found',
  'an id that does not belong to the email deletes nothing');
SELECT is(service_delete_account_for_website('51000000-0000-0000-0000-000000000002','unverified-del@example.com'), 'not_found',
  'an unverified account is not deleted');
SELECT is(service_delete_account_for_website('51000000-0000-0000-0000-000000000003','coach-del@example.com'), 'protected',
  'staff are not deleted');
SELECT is(service_delete_account_for_website('51000000-0000-0000-0000-000000000005','matt@soberhelpline.com'), 'protected',
  'the owner is not deleted');
SELECT is((SELECT count(*)::integer FROM auth.users WHERE id::text LIKE '51000000-0000-0000-0000-00000000000%'), 5,
  'nothing has been deleted so far');

SELECT is(service_delete_account_for_website('51000000-0000-0000-0000-000000000001','MEMBER@example.com'), 'deleted',
  'the matching member is deleted');
SELECT is((SELECT count(*)::integer FROM auth.users WHERE id='51000000-0000-0000-0000-000000000001'), 0,
  'their login is gone');
SELECT is((SELECT count(*)::integer FROM accounts WHERE user_id='51000000-0000-0000-0000-000000000001'), 0,
  'their app account went with it');
SELECT is((SELECT count(*)::integer FROM auth.users WHERE id::text LIKE '51000000-0000-0000-0000-00000000000%'), 4,
  'nobody else was touched');
SELECT is(service_delete_account_for_website('51000000-0000-0000-0000-000000000001','member@example.com'), 'not_found',
  'asking again is harmless');

-- A coach whose role is switched off is an ordinary account again.
UPDATE video_staff_roles SET active=false
  WHERE account_id=(SELECT id FROM accounts WHERE user_id='51000000-0000-0000-0000-000000000003');
SELECT is((SELECT protected FROM service_account_deletion_target('coach-del@example.com')), false,
  'former staff are no longer protected');

SELECT * FROM finish();
ROLLBACK;
