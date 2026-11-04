BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(16);

-- ── Accounts: A has no loved-one row yet, B has one; the admin has a device ──
INSERT INTO auth.users(id, email, raw_app_meta_data, raw_user_meta_data, aud, role, email_confirmed_at) VALUES
  ('17000000-0000-0000-0000-000000000001', 'bv-a@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('17000000-0000-0000-0000-000000000002', 'bv-b@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('17000000-0000-0000-0000-0000000000ff', 'matt@soberhelpline.com', '{}', '{}', 'authenticated', 'authenticated', now())
ON CONFLICT (id) DO NOTHING;
UPDATE public.accounts SET id = ('27000000-0000-0000-0000-00000000000' || right(user_id::text, 1))::uuid
WHERE user_id::text LIKE '17000000-0000-0000-0000-00000000000_';
UPDATE public.accounts SET push_token = 'ExponentPushToken[bv-admin]' WHERE user_id = '17000000-0000-0000-0000-0000000000ff';
INSERT INTO public.loved_ones(account_id, stage, status) VALUES ('27000000-0000-0000-0000-000000000002', 'active_use', 'using');

SELECT ok(NOT has_function_privilege('anon', 'public.mark_loved_one_died(boolean)', 'execute'), 'anon cannot mark a death');
SELECT ok(NOT has_function_privilege('authenticated', 'public._account_bereaved(uuid)', 'execute'), 'clients cannot read the helper');
SELECT ok(has_function_privilege('authenticated', 'public.clear_loved_one_died()', 'execute'), 'members can undo their own');

-- ── A marks it with permission to reach out; B without ─────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"17000000-0000-0000-0000-000000000001","email":"bv-a@example.com","role":"authenticated"}', true);
SELECT isnt(public.mark_loved_one_died(true), NULL::timestamptz, 'marking returns the date');
SELECT is(public.mark_loved_one_died(true), (SELECT died_at FROM public.loved_ones WHERE account_id = '27000000-0000-0000-0000-000000000001'),
  'marking again keeps the first date');
SELECT set_config('request.jwt.claims', '{"sub":"17000000-0000-0000-0000-000000000002","email":"bv-b@example.com","role":"authenticated"}', true);
SELECT lives_ok($$SELECT public.mark_loved_one_died(false)$$, 'B marks without asking for contact');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM public.loved_ones WHERE account_id = '27000000-0000-0000-0000-000000000001' AND died_at IS NOT NULL AND bereavement_contact),
  1, 'A had no row: one is created, with permission to reach out');
SELECT is((SELECT stage FROM public.loved_ones WHERE account_id = '27000000-0000-0000-0000-000000000002'), 'active_use', 'B''s other details are kept');
SELECT is((SELECT count(*)::int FROM public.push_outbox WHERE kind = 'admin_bereavement' AND metadata->>'member_account_id' = '27000000-0000-0000-0000-000000000001'),
  1, 'one admin alert for A, even after marking twice');
SELECT is((SELECT count(*)::int FROM public.push_outbox WHERE kind = 'admin_bereavement' AND metadata->>'member_account_id' = '27000000-0000-0000-0000-000000000002'),
  0, 'no alert without her permission');
SELECT ok(public._account_bereaved('27000000-0000-0000-0000-000000000002'), 'B is bereaved');

-- ── The admin alert is delivered while it still applies ───────────────────
UPDATE public.push_outbox SET processing_token = '00000000-0000-0000-0000-0000000000aa', processing_at = now(), scheduled_for = now() - interval '1 minute'
WHERE kind = 'admin_bereavement' AND metadata->>'member_account_id' = '27000000-0000-0000-0000-000000000001';
SELECT isnt(public.dispatcher_outbox_delivery(
  (SELECT id FROM public.push_outbox WHERE kind = 'admin_bereavement' AND metadata->>'member_account_id' = '27000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-0000000000aa'), NULL::jsonb, 'the admin alert is delivered');

-- ── Undo is her own only ──────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"17000000-0000-0000-0000-000000000001","email":"bv-a@example.com","role":"authenticated"}', true);
SELECT lives_ok($$SELECT public.clear_loved_one_died()$$, 'A undoes it');
RESET ROLE;
SELECT ok(NOT public._account_bereaved('27000000-0000-0000-0000-000000000001') AND public._account_bereaved('27000000-0000-0000-0000-000000000002'),
  'undo clears A only; B is untouched');
SELECT is(public.dispatcher_outbox_delivery(
  (SELECT id FROM public.push_outbox WHERE kind = 'admin_bereavement' AND metadata->>'member_account_id' = '27000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-0000000000aa'), NULL::jsonb, 'after undo the alert is no longer sent');

-- ── Pushes about the loved one stop for a bereaved account ────────────────
SELECT ok(pg_get_functiondef('public.dispatcher_outbox_delivery(uuid,uuid)'::regprocedure)
  ~ 'IF o.kind IN \(''invitation_window'',''practice_incoming''\) AND _account_bereaved\(a.id\) THEN RETURN NULL',
  'receptivity windows and incoming-call practice are not delivered after a death');

SELECT * FROM finish();
ROLLBACK;
