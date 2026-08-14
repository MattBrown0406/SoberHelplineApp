BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(15);

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
VALUES
  ('61000000-0000-0000-0000-000000000001', 'hold-owner@example.com', '{}', '{"first_name":"Maria"}', 'authenticated', 'authenticated'),
  ('61000000-0000-0000-0000-000000000002', 'hold-member@example.com', '{}', '{"first_name":"James"}', 'authenticated', 'authenticated'),
  ('61000000-0000-0000-0000-000000000003', 'hold-stranger@example.com', '{}', '{"first_name":"Pat"}', 'authenticated', 'authenticated');

UPDATE public.accounts SET first_name='Maria' WHERE user_id='61000000-0000-0000-0000-000000000001';
UPDATE public.accounts SET first_name='James' WHERE user_id='61000000-0000-0000-0000-000000000002';
UPDATE public.accounts SET first_name='Pat' WHERE user_id='61000000-0000-0000-0000-000000000003';

INSERT INTO public.family_spaces (id, name, created_by, invite_code)
VALUES (
  '71000000-0000-0000-0000-000000000001',
  'Hold family',
  (SELECT id FROM accounts WHERE user_id='61000000-0000-0000-0000-000000000001'),
  'HOLD-WALL'
);
INSERT INTO public.family_members (family_space_id, account_id, role)
VALUES
  ('71000000-0000-0000-0000-000000000001', (SELECT id FROM accounts WHERE user_id='61000000-0000-0000-0000-000000000001'), 'owner'),
  ('71000000-0000-0000-0000-000000000001', (SELECT id FROM accounts WHERE user_id='61000000-0000-0000-0000-000000000002'), 'member');

INSERT INTO public.family_spaces (id, name, created_by, invite_code)
VALUES (
  '71000000-0000-0000-0000-000000000002',
  'Other family',
  (SELECT id FROM accounts WHERE user_id='61000000-0000-0000-0000-000000000003'),
  'OTHER-WALL'
);
INSERT INTO public.family_members (family_space_id, account_id, role)
VALUES (
  '71000000-0000-0000-0000-000000000002',
  (SELECT id FROM accounts WHERE user_id='61000000-0000-0000-0000-000000000003'),
  'owner'
);

SELECT ok(
  has_table_privilege('authenticated','public.wall_hold_logs','SELECT')
  AND has_table_privilege('authenticated','public.wall_hold_logs','INSERT')
  AND has_table_privilege('authenticated','public.wall_hold_logs','UPDATE')
  AND NOT has_table_privilege('authenticated','public.wall_hold_logs','DELETE'),
  'members can write hold logs but cannot hard-delete them'
);
SELECT ok(has_function_privilege('authenticated','public.family_member_profiles(uuid)','EXECUTE'), 'members can read family first names via RPC');
SELECT ok(NOT has_function_privilege('anon','public.family_member_profiles(uuid)','EXECUTE'), 'anon cannot read family first names');
SELECT ok(has_function_privilege('authenticated','public.propose_shared_wall(text,text,text,uuid)','EXECUTE'), 'members can propose a shared wall');
SELECT ok(has_function_privilege('authenticated','public.record_wall_wavering(uuid,boolean)','EXECUTE'), 'members can record wavering');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- Look up the co-member via family_members (space-visible) rather than
-- accounts: accounts RLS only allows reading your own row, so joining
-- accounts.user_id here would hide James even when the RPC is correct.
SELECT is(
  (
    SELECT p.first_name
    FROM public.family_member_profiles('71000000-0000-0000-0000-000000000001') AS p
    JOIN public.family_members AS fm
      ON fm.account_id = p.account_id
     AND fm.family_space_id = '71000000-0000-0000-0000-000000000001'
    WHERE fm.role = 'member'
  ),
  'James',
  'co-members see real first names, not a generic Member label'
);

SELECT lives_ok(
  $$SELECT public.propose_shared_wall('I will no longer give cash')$$,
  'owner can propose a personal wall into Family Space'
);

SELECT is(
  (SELECT count(*)::integer FROM shared_walls WHERE family_space_id='71000000-0000-0000-0000-000000000001'),
  1,
  'propose_shared_wall inserts exactly one shared wall'
);

SELECT lives_ok(
  $$SELECT public.record_wall_wavering((SELECT id FROM shared_walls WHERE family_space_id='71000000-0000-0000-0000-000000000001' LIMIT 1), true)$$,
  'owner can persist wavering and opt in to family backup'
);

SELECT is(
  (SELECT status FROM wall_commitments WHERE account_id=public.my_account_id()),
  'wavering',
  'wavering updates the commitment row instead of remaining an alert-only tap'
);

INSERT INTO public.wall_hold_logs (account_id, family_space_id, week_start, result, shared_with_family)
VALUES (public.my_account_id(), '71000000-0000-0000-0000-000000000001', '2026-08-10', 'held', false);

SELECT throws_ok(
  $$INSERT INTO public.wall_hold_logs (account_id, family_space_id, week_start, result, shared_with_family)
    VALUES (public.my_account_id(), '71000000-0000-0000-0000-000000000002', '2026-08-03', 'held', true)$$,
  '42501',
  'new row violates row-level security policy for table "wall_hold_logs"',
  'member cannot inject a shared hold log into another family space'
);

SELECT throws_ok(
  $$UPDATE public.wall_hold_logs
    SET family_space_id='71000000-0000-0000-0000-000000000002', shared_with_family=true
    WHERE account_id=public.my_account_id()$$,
  '42501',
  'new row violates row-level security policy for table "wall_hold_logs"',
  'member cannot move an existing hold log into another family space'
);

SELECT is(
  (SELECT count(*)::integer FROM wavering_events WHERE notification_claimed_at IS NOT NULL),
  0,
  'new wavering notifications start unclaimed for one-time delivery'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

SELECT is(
  (SELECT count(*)::integer FROM wall_hold_logs WHERE family_space_id='71000000-0000-0000-0000-000000000001'),
  0,
  'private hold logs are not visible to other family members'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
UPDATE public.wall_hold_logs SET shared_with_family=true WHERE account_id=public.my_account_id();

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT is(
  (SELECT result FROM wall_hold_logs WHERE family_space_id='71000000-0000-0000-0000-000000000001'),
  'held',
  'opt-in shared hold logs are visible to family members'
);

SELECT * FROM finish();
ROLLBACK;
