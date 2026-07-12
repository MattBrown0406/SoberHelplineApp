BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;

SELECT plan(21);

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
VALUES
  ('31000000-0000-0000-0000-000000000001', 'family-owner-a@example.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('31000000-0000-0000-0000-000000000002', 'family-owner-b@example.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('31000000-0000-0000-0000-000000000003', 'family-joiner@example.com',  '{}', '{}', 'authenticated', 'authenticated'),
  ('31000000-0000-0000-0000-000000000004', 'family-attacker@example.com','{}', '{}', 'authenticated', 'authenticated');

INSERT INTO public.family_spaces (id, name, created_by, invite_code)
VALUES
  ('41000000-0000-0000-0000-000000000001', 'Security family A', (SELECT id FROM accounts WHERE user_id = '31000000-0000-0000-0000-000000000001'), 'A1B2-C3D4'),
  ('41000000-0000-0000-0000-000000000002', 'Security family B', (SELECT id FROM accounts WHERE user_id = '31000000-0000-0000-0000-000000000002'), 'DEAD-BEEF');
INSERT INTO public.family_members (family_space_id, account_id, role)
VALUES
  ('41000000-0000-0000-0000-000000000001', (SELECT id FROM accounts WHERE user_id = '31000000-0000-0000-0000-000000000001'), 'owner'),
  ('41000000-0000-0000-0000-000000000002', (SELECT id FROM accounts WHERE user_id = '31000000-0000-0000-0000-000000000002'), 'owner');

SELECT is(
  (SELECT count(*)::integer FROM pg_policies WHERE schemaname='public' AND tablename='family_members' AND cmd='INSERT'),
  0,
  'family_members has no INSERT policies');
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.family_members', 'INSERT'),
  'authenticated has no direct family_members INSERT privilege');
SELECT ok(
  NOT has_table_privilege('anon', 'public.family_members', 'INSERT'),
  'anon has no direct family_members INSERT privilege');
SELECT ok(has_function_privilege('authenticated', 'public.join_family_space(text)', 'EXECUTE'), 'authenticated can execute join RPC');
SELECT ok(NOT has_function_privilege('anon', 'public.join_family_space(text)', 'EXECUTE'), 'anon cannot execute join RPC');
SELECT ok(NOT has_function_privilege('public', 'public.join_family_space(text)', 'EXECUTE'), 'PUBLIC cannot execute join RPC');
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='join_family_space'
      AND pg_get_function_identity_arguments(p.oid) <> 'p_invite_code text'
  ),
  'join RPC exposes no family UUID or role overload');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"31000000-0000-0000-0000-000000000003","email":"family-joiner@example.com","role":"authenticated"}',true);

SELECT throws_ok(
  $$INSERT INTO public.family_members (family_space_id, account_id, role)
    VALUES ('41000000-0000-0000-0000-000000000001', (SELECT id FROM accounts WHERE user_id=auth.uid()), 'member')$$,
  '42501', NULL, 'authenticated direct member INSERT is denied');
SELECT throws_ok(
  $$INSERT INTO public.family_members (family_space_id, account_id, role)
    VALUES ('41000000-0000-0000-0000-000000000002', (SELECT id FROM accounts WHERE user_id=auth.uid()), 'owner')$$,
  '42501', NULL, 'caller cannot self-assign owner role');
SELECT throws_ok($$SELECT public.join_family_space('not-a-code')$$, '22023', 'invalid_invite_code', 'malformed invite is denied');
SELECT throws_ok($$SELECT public.join_family_space('A1B2-C3D5')$$, '22023', 'invalid_invite_code', 'near-match invite is denied');

RESET ROLE;
SELECT is((SELECT count(*)::integer FROM family_members WHERE account_id=(SELECT id FROM accounts WHERE user_id='31000000-0000-0000-0000-000000000003')), 0, 'failed invite attacks create no membership');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"31000000-0000-0000-0000-000000000003","email":"family-joiner@example.com","role":"authenticated"}',true);
SELECT is(public.join_family_space(' a1b2-c3d4 '), '41000000-0000-0000-0000-000000000001'::uuid, 'normalized exact invite joins intended family');
SELECT is(public.join_family_space('A1B2-C3D4'), '41000000-0000-0000-0000-000000000001'::uuid, 'repeat valid join is idempotent');

RESET ROLE;
SELECT is((SELECT count(*)::integer FROM family_members WHERE account_id=(SELECT id FROM accounts WHERE user_id='31000000-0000-0000-0000-000000000003')), 1, 'valid invite creates exactly one membership');
SELECT is((SELECT role FROM family_members WHERE account_id=(SELECT id FROM accounts WHERE user_id='31000000-0000-0000-0000-000000000003')), 'member', 'join role is hard-coded member');
SELECT is((SELECT count(*)::integer FROM family_members WHERE family_space_id='41000000-0000-0000-0000-000000000002' AND account_id=(SELECT id FROM accounts WHERE user_id='31000000-0000-0000-0000-000000000003')), 0, 'code mismatch cannot join a different family UUID');

-- Tightening invite joins must not break the separate trusted owner-creation path.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"31000000-0000-0000-0000-000000000004","email":"family-attacker@example.com","role":"authenticated"}',true);
SELECT lives_ok($$SELECT public.create_family_space('Owner path regression')$$, 'create_family_space can still create its owner membership');
RESET ROLE;
SELECT is(
  (SELECT count(*)::integer
   FROM family_members fm
   JOIN family_spaces fs ON fs.id=fm.family_space_id
   WHERE fs.name='Owner path regression'
     AND fm.account_id=(SELECT id FROM accounts WHERE user_id='31000000-0000-0000-0000-000000000004')
     AND fm.role='owner'),
  1,
  'create_family_space still creates exactly one owner row');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"role":"authenticated"}',true);
SELECT throws_ok($$SELECT public.join_family_space('DEAD-BEEF')$$, '28000', 'not_authenticated', 'authenticated role without Auth identity is denied');

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
SELECT throws_ok($$SELECT public.join_family_space('DEAD-BEEF')$$, '42501', NULL, 'anonymous caller cannot execute join RPC');

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
