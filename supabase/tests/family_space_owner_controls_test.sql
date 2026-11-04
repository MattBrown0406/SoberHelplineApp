BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(11);

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role) VALUES
  ('31100000-0000-0000-0000-000000000001', 'owner-controls@example.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('31100000-0000-0000-0000-000000000002', 'member-controls@example.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('31100000-0000-0000-0000-000000000003', 'intruder-controls@example.com', '{}', '{}', 'authenticated', 'authenticated');
UPDATE public.accounts SET id='51100000-0000-0000-0000-000000000001' WHERE user_id='31100000-0000-0000-0000-000000000001';
UPDATE public.accounts SET id='51100000-0000-0000-0000-000000000002' WHERE user_id='31100000-0000-0000-0000-000000000002';
UPDATE public.accounts SET id='51100000-0000-0000-0000-000000000003' WHERE user_id='31100000-0000-0000-0000-000000000003';
INSERT INTO public.family_spaces (id, name, created_by, invite_code) VALUES
  ('41100000-0000-0000-0000-000000000001', 'Owner', '51100000-0000-0000-0000-000000000001', 'AAAA-1111');
INSERT INTO public.family_members (family_space_id, account_id, role) VALUES
  ('41100000-0000-0000-0000-000000000001', '51100000-0000-0000-0000-000000000001', 'owner'),
  ('41100000-0000-0000-0000-000000000001', '51100000-0000-0000-0000-000000000002', 'member'),
  ('41100000-0000-0000-0000-000000000001', '51100000-0000-0000-0000-000000000003', 'member');

SELECT ok(NOT has_function_privilege('anon', 'public.remove_family_member(uuid)', 'EXECUTE'), 'anon cannot remove members');
SELECT ok(NOT has_function_privilege('anon', 'public.regenerate_family_invite_code()', 'EXECUTE'), 'anon cannot change the code');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"31100000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SELECT throws_ok(
  $$SELECT public.remove_family_member('51100000-0000-0000-0000-000000000002')$$,
  '42501', 'not_family_owner', 'a member cannot remove another member');
SELECT throws_ok($$SELECT public.regenerate_family_invite_code()$$, '42501', 'not_family_owner', 'a member cannot change the invite code');

SELECT set_config('request.jwt.claims','{"sub":"31100000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SELECT throws_ok($$SELECT public.remove_family_member(public.my_account_id())$$, '22023', 'invalid_member', 'the owner leaves rather than removing herself');
SELECT lives_ok(
  $$SELECT public.remove_family_member('51100000-0000-0000-0000-000000000003')$$,
  'the owner removes an intruder');
SELECT isnt((SELECT invite_code FROM family_spaces WHERE id='41100000-0000-0000-0000-000000000001'), 'AAAA-1111',
  'removing someone also replaces the code they could see');
SELECT isnt(public.regenerate_family_invite_code(), 'AAAA-1111', 'the owner gets a new invite code');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM family_members WHERE family_space_id='41100000-0000-0000-0000-000000000001'), 2, 'only the intruder was removed');
SELECT ok((SELECT invite_code ~ '^[0-9A-F]{4}-[0-9A-F]{4}$' FROM family_spaces WHERE id='41100000-0000-0000-0000-000000000001'), 'the new code has the joinable shape');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"31100000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SELECT is(public.join_family_space('AAAA-1111'), NULL::uuid, 'the old code no longer lets the intruder back in');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
