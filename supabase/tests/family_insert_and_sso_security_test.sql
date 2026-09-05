BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(27);

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


SELECT set_config('test.other_account', (SELECT id::text FROM accounts WHERE user_id='61000000-0000-0000-0000-000000000002'), true);
INSERT INTO shared_walls(id,family_space_id,proposed_by,text)
VALUES ('81000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000002',
 (SELECT id FROM accounts WHERE user_id='61000000-0000-0000-0000-000000000003'),'foreign');
INSERT INTO walls(id,account_id,text) VALUES
 ('a1000000-0000-0000-0000-000000000001',(SELECT id FROM accounts WHERE user_id='61000000-0000-0000-0000-000000000001'),'synthetic own'),
 ('a1000000-0000-0000-0000-000000000002',(SELECT id FROM accounts WHERE user_id='61000000-0000-0000-0000-000000000003'),'synthetic foreign');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SELECT throws_ok($$INSERT INTO shared_walls(family_space_id,proposed_by,text) VALUES
 ('71000000-0000-0000-0000-000000000001',current_setting('test.other_account')::uuid,'spoof')$$,
 '42501',NULL,'cannot spoof a co-member author');
SELECT throws_ok($$INSERT INTO shared_walls(family_space_id,proposed_by,text) VALUES
 ('71000000-0000-0000-0000-000000000002',my_account_id(),'foreign')$$,
 '42501',NULL,'cannot insert a wall in another family');
SELECT lives_ok($$INSERT INTO shared_walls(id,family_space_id,proposed_by,text) VALUES
 ('81000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001',my_account_id(),'own')$$,
 'member can still directly propose their own wall');
SELECT lives_ok($$INSERT INTO shared_walls(family_space_id,proposed_by,text,source_wall_id) VALUES
 ('71000000-0000-0000-0000-000000000001',my_account_id(),'own source','a1000000-0000-0000-0000-000000000001')$$,'direct own source accepted');
SELECT throws_ok($$INSERT INTO shared_walls(family_space_id,proposed_by,text,source_wall_id) VALUES
 ('71000000-0000-0000-0000-000000000001',my_account_id(),'foreign source','a1000000-0000-0000-0000-000000000002')$$,'42501',NULL,'direct foreign source rejected');
SELECT lives_ok($$SELECT propose_shared_wall('own source',NULL,NULL,'a1000000-0000-0000-0000-000000000001')$$,'RPC own source accepted');
SELECT lives_ok($$SELECT propose_shared_wall('null source',NULL,NULL,NULL)$$,'RPC null source accepted');
SELECT throws_ok($$SELECT propose_shared_wall('foreign source',NULL,NULL,'a1000000-0000-0000-0000-000000000002')$$,'42501','source_wall_not_owned','RPC foreign source rejected');
SELECT throws_ok($$UPDATE shared_walls SET proposed_by=current_setting('test.other_account')::uuid
 WHERE id='81000000-0000-0000-0000-000000000001'$$,'42501',NULL,'cannot rewrite wall authorship');
SELECT lives_ok($$UPDATE shared_walls SET text='edited' WHERE id='81000000-0000-0000-0000-000000000001'$$,
 'member can still edit wall content');
SELECT throws_ok($$INSERT INTO wall_commitments(shared_wall_id,account_id) VALUES
 ('81000000-0000-0000-0000-000000000002',my_account_id())$$,'42501',NULL,'own commitment cannot target foreign wall');
SELECT throws_ok($$INSERT INTO wavering_events(shared_wall_id,account_id,shared_with_family) VALUES
 ('81000000-0000-0000-0000-000000000002',my_account_id(),true)$$,'42501',NULL,'own wavering cannot target foreign wall');
SELECT throws_ok($$INSERT INTO wall_commitments(shared_wall_id,account_id) VALUES
 ('81000000-0000-0000-0000-000000000001',current_setting('test.other_account')::uuid)$$,'42501',NULL,'cannot spoof commitment owner');
SELECT throws_ok($$INSERT INTO wavering_events(shared_wall_id,account_id) VALUES
 ('81000000-0000-0000-0000-000000000001',current_setting('test.other_account')::uuid)$$,'42501',NULL,'cannot spoof wavering owner');
SELECT lives_ok($$INSERT INTO wall_commitments(shared_wall_id,account_id) VALUES
 ('81000000-0000-0000-0000-000000000001',my_account_id()) ON CONFLICT(shared_wall_id,account_id)
 DO UPDATE SET status='committed',updated_at=now()$$,'app commitment upsert inserts');
SELECT lives_ok($$INSERT INTO wall_commitments(shared_wall_id,account_id) VALUES
 ('81000000-0000-0000-0000-000000000001',my_account_id()) ON CONFLICT(shared_wall_id,account_id)
 DO UPDATE SET status='committed',updated_at=now()$$,'app commitment upsert updates');
SELECT throws_ok($$UPDATE wall_commitments SET shared_wall_id='81000000-0000-0000-0000-000000000002'
 WHERE shared_wall_id='81000000-0000-0000-0000-000000000001'$$,'42501',NULL,'cannot move own commitment to foreign wall');
SELECT lives_ok($$INSERT INTO wavering_events(shared_wall_id,account_id) VALUES
 ('81000000-0000-0000-0000-000000000001',my_account_id())$$,'direct own-family wavering remains valid');
SELECT lives_ok($$SELECT propose_shared_wall('RPC wall')$$,'propose RPC remains valid');
SELECT lives_ok($$SELECT record_wall_wavering('81000000-0000-0000-0000-000000000001',true)$$,'wavering RPC remains valid');
SELECT throws_ok($$SELECT record_wall_wavering('81000000-0000-0000-0000-000000000002',true)$$,'42501','not_family_member','RPC also rejects foreign wall');
SELECT throws_ok($$INSERT INTO web_sso_tokens(id,account_id,expires_at) VALUES
 ('91000000-0000-0000-0000-000000000001',my_account_id(),now()+interval '10 years')$$,
 '42501','permission denied for table web_sso_tokens','cannot choose an SSO token or arbitrary expiration');
SELECT set_config('test.sso_token',create_web_sso_token()::text,true);
RESET ROLE;
SELECT ok(NOT has_table_privilege('authenticated','web_sso_tokens','INSERT')
 AND NOT has_table_privilege('anon','web_sso_tokens','INSERT'),'clients lack direct SSO insert privilege');
SELECT ok(NOT has_function_privilege('anon','create_web_sso_token()','EXECUTE'),'anon cannot mint SSO tokens');
SELECT is((SELECT expires_at-created_at FROM web_sso_tokens WHERE id=current_setting('test.sso_token')::uuid),
 interval '5 minutes','RPC token has server-controlled five-minute lifetime');
SELECT is((SELECT account_id FROM web_sso_tokens WHERE id=current_setting('test.sso_token')::uuid),
 (SELECT id FROM accounts WHERE user_id='61000000-0000-0000-0000-000000000001'),'RPC token belongs to caller');
SELECT is((SELECT count(*)::integer FROM wall_commitments WHERE shared_wall_id='81000000-0000-0000-0000-000000000002'),0,'foreign family remains unmodified');
SELECT * FROM finish();
ROLLBACK;
