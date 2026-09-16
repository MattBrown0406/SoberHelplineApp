BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;

SELECT plan(18);

-- Space 1: creator Ana, then Rosa (joined first), then Ben (joined later).
-- Space 2: creator Dan, alone.
-- Space 3: creator Eve with member Finn; Finn (not the creator) deletes.
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
VALUES
  ('51000000-0000-0000-0000-000000000001', 'succession-ana@example.com',  '{}', '{"first_name":"Ana"}',  'authenticated', 'authenticated'),
  ('51000000-0000-0000-0000-000000000002', 'succession-rosa@example.com', '{}', '{"first_name":"Rosa"}', 'authenticated', 'authenticated'),
  ('51000000-0000-0000-0000-000000000003', 'succession-ben@example.com',  '{}', '{"first_name":"Ben"}',  'authenticated', 'authenticated'),
  ('51000000-0000-0000-0000-000000000004', 'succession-dan@example.com',  '{}', '{"first_name":"Dan"}',  'authenticated', 'authenticated'),
  ('51000000-0000-0000-0000-000000000005', 'succession-eve@example.com',  '{}', '{"first_name":"Eve"}',  'authenticated', 'authenticated'),
  ('51000000-0000-0000-0000-000000000006', 'succession-finn@example.com', '{}', '{"first_name":"Finn"}', 'authenticated', 'authenticated');

INSERT INTO public.family_spaces (id, name, created_by, invite_code)
VALUES
  ('61000000-0000-0000-0000-000000000001', 'Ana', (SELECT id FROM accounts WHERE user_id = '51000000-0000-0000-0000-000000000001'), 'SUCC-0001'),
  ('61000000-0000-0000-0000-000000000002', 'Dan', (SELECT id FROM accounts WHERE user_id = '51000000-0000-0000-0000-000000000004'), 'SUCC-0002'),
  ('61000000-0000-0000-0000-000000000003', 'Eve', (SELECT id FROM accounts WHERE user_id = '51000000-0000-0000-0000-000000000005'), 'SUCC-0003');

INSERT INTO public.family_members (family_space_id, account_id, role, joined_at)
VALUES
  ('61000000-0000-0000-0000-000000000001', (SELECT id FROM accounts WHERE user_id = '51000000-0000-0000-0000-000000000001'), 'owner',  '2026-01-01T00:00:00Z'),
  ('61000000-0000-0000-0000-000000000001', (SELECT id FROM accounts WHERE user_id = '51000000-0000-0000-0000-000000000002'), 'member', '2026-01-02T00:00:00Z'),
  ('61000000-0000-0000-0000-000000000001', (SELECT id FROM accounts WHERE user_id = '51000000-0000-0000-0000-000000000003'), 'member', '2026-01-03T00:00:00Z'),
  ('61000000-0000-0000-0000-000000000002', (SELECT id FROM accounts WHERE user_id = '51000000-0000-0000-0000-000000000004'), 'owner',  '2026-01-01T00:00:00Z'),
  ('61000000-0000-0000-0000-000000000003', (SELECT id FROM accounts WHERE user_id = '51000000-0000-0000-0000-000000000005'), 'owner',  '2026-01-01T00:00:00Z'),
  ('61000000-0000-0000-0000-000000000003', (SELECT id FROM accounts WHERE user_id = '51000000-0000-0000-0000-000000000006'), 'member', '2026-01-02T00:00:00Z');

-- Shared data that must outlive the creator.
INSERT INTO public.shared_walls (id, family_space_id, proposed_by, text, anchor)
VALUES ('71000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001',
        (SELECT id FROM accounts WHERE user_id = '51000000-0000-0000-0000-000000000002'), 'We will not hand over cash.', 'enabling');

-- Wiring -------------------------------------------------------------------
SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'transfer_family_spaces_before_account_delete' AND tgrelid = 'public.accounts'::regclass AND NOT tgisinternal),
  'accounts has the succession trigger');
SELECT is(
  (SELECT confdeltype::text FROM pg_constraint WHERE conname = 'family_spaces_created_by_fkey' AND conrelid = 'public.family_spaces'::regclass),
  'r',
  'family_spaces.created_by no longer cascades from accounts (RESTRICT)');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.transfer_family_spaces_before_account_delete()', 'EXECUTE'),
  'clients cannot call the succession function directly');

-- Creator deletes; longest-standing member inherits ------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"51000000-0000-0000-0000-000000000001","email":"succession-ana@example.com","role":"authenticated"}',true);
SELECT lives_ok($$SELECT public.delete_own_account()$$, 'creator can still delete their own account');
RESET ROLE;

SELECT is((SELECT count(*)::integer FROM auth.users WHERE id = '51000000-0000-0000-0000-000000000001'), 0, 'creator auth user is gone');
SELECT is((SELECT count(*)::integer FROM family_spaces WHERE id = '61000000-0000-0000-0000-000000000001'), 1, 'the family space survives its creator');
SELECT is(
  (SELECT created_by FROM family_spaces WHERE id = '61000000-0000-0000-0000-000000000001'),
  (SELECT id FROM accounts WHERE user_id = '51000000-0000-0000-0000-000000000002'),
  'ownership passes to the longest-standing remaining member (earliest joined_at), not the most recent');
SELECT is((SELECT name FROM family_spaces WHERE id = '61000000-0000-0000-0000-000000000001'), 'Rosa', 'the space is renamed for its new owner');
SELECT is((SELECT invite_code FROM family_spaces WHERE id = '61000000-0000-0000-0000-000000000001'), 'SUCC-0001', 'the invite code is unchanged');
SELECT is(
  (SELECT role FROM family_members WHERE family_space_id = '61000000-0000-0000-0000-000000000001' AND account_id = (SELECT id FROM accounts WHERE user_id = '51000000-0000-0000-0000-000000000002')),
  'owner',
  'the successor is marked owner in family_members');
SELECT is(
  (SELECT role FROM family_members WHERE family_space_id = '61000000-0000-0000-0000-000000000001' AND account_id = (SELECT id FROM accounts WHERE user_id = '51000000-0000-0000-0000-000000000003')),
  'member',
  'the later member stays a member');
SELECT is((SELECT count(*)::integer FROM family_members WHERE family_space_id = '61000000-0000-0000-0000-000000000001'), 2, 'only the deleted creator left the member list');
SELECT is((SELECT count(*)::integer FROM shared_walls WHERE id = '71000000-0000-0000-0000-000000000001'), 1, 'shared walls in the space survive');

-- RLS follows the new owner ------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"51000000-0000-0000-0000-000000000003","email":"succession-ben@example.com","role":"authenticated"}',true);
UPDATE family_spaces SET name = 'Ben' WHERE id = '61000000-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claims','{"sub":"51000000-0000-0000-0000-000000000002","email":"succession-rosa@example.com","role":"authenticated"}',true);
SELECT is((SELECT name FROM family_spaces WHERE id = '61000000-0000-0000-0000-000000000001'), 'Rosa', 'a non-owner member cannot rename the inherited space');
UPDATE family_spaces SET name = 'Rosa M' WHERE id = '61000000-0000-0000-0000-000000000001';
RESET ROLE;
SELECT is((SELECT name FROM family_spaces WHERE id = '61000000-0000-0000-0000-000000000001'), 'Rosa M', 'the successor holds the owner update policy');

-- Creator deletes with nobody left; space is removed -----------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"51000000-0000-0000-0000-000000000004","email":"succession-dan@example.com","role":"authenticated"}',true);
SELECT lives_ok($$SELECT public.delete_own_account()$$, 'a lone creator can delete their own account');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM family_spaces WHERE id = '61000000-0000-0000-0000-000000000002'), 0, 'a space with no remaining members is deleted');

-- A non-creator member deleting changes nothing about ownership ------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"51000000-0000-0000-0000-000000000006","email":"succession-finn@example.com","role":"authenticated"}',true);
SELECT public.delete_own_account();
RESET ROLE;
SELECT is(
  (SELECT created_by FROM family_spaces WHERE id = '61000000-0000-0000-0000-000000000003'),
  (SELECT id FROM accounts WHERE user_id = '51000000-0000-0000-0000-000000000005'),
  'a member deleting their account leaves the creator in place');

SELECT * FROM finish();
ROLLBACK;
