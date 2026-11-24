BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

-- App 4.4: after a hard check-in a member may ask Matt to reach out
-- (20261124120000_checkin_reach_out_requests).

-- ── Accounts: free, member (Essential), attached (active org), admin/owner ──
INSERT INTO auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role) VALUES
 ('cf000000-0000-0000-0000-000000000001','ro-free@example.com',now(),'{}','{}','authenticated','authenticated'),
 ('cf000000-0000-0000-0000-000000000002','ro-member@example.com',now(),'{}','{}','authenticated','authenticated'),
 ('cf000000-0000-0000-0000-000000000003','ro-org@example.com',now(),'{}','{}','authenticated','authenticated'),
 ('cf000000-0000-0000-0000-0000000000ff','matt@soberhelpline.com',now(),'{}','{}','authenticated','authenticated')
ON CONFLICT (id) DO NOTHING;
UPDATE public.accounts SET id = ('cf100000-0000-0000-0000-' || right(user_id::text, 12))::uuid
WHERE user_id::text LIKE 'cf000000-0000-0000-0000-0000000000%';
UPDATE public.accounts SET first_name = 'Dana' WHERE id = 'cf100000-0000-0000-0000-000000000002';
INSERT INTO public.entitlements(account_id, source, tier, expires_at) VALUES
 ('cf100000-0000-0000-0000-000000000002', 'revenuecat', 'essential', now() + interval '30 days'),
 -- An attached account with a paid tier too: still its own team's to reach.
 ('cf100000-0000-0000-0000-000000000003', 'revenuecat', 'essential', now() + interval '30 days');
INSERT INTO public.orgs(id, name, status) VALUES ('cf200000-0000-0000-0000-000000000001', 'Reach Out Test Org', 'active');
UPDATE public.accounts SET type = 'attached', org_id = 'cf200000-0000-0000-0000-000000000001'
WHERE id = 'cf100000-0000-0000-0000-000000000003';
UPDATE public.accounts SET push_token = 'ExponentPushToken[ro-owner]' WHERE id = 'cf100000-0000-0000-0000-0000000000ff';
INSERT INTO public.video_staff_roles(account_id, role, active)
VALUES ('cf100000-0000-0000-0000-0000000000ff', 'owner', true)
ON CONFLICT (account_id) DO UPDATE SET role = 'owner', active = true;

CREATE TEMP TABLE ro_owners AS
SELECT count(*)::int AS n FROM public.video_staff_roles WHERE role = 'owner' AND active;
GRANT SELECT ON ro_owners TO authenticated;

-- ── Nobody reaches the table directly ─────────────────────────────────────
SELECT ok(NOT has_table_privilege('authenticated', 'public.reach_out_requests', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.reach_out_requests', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.reach_out_requests', 'SELECT'),
  'members and anon cannot read or write reach_out_requests');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.reach_out_requests'::regclass), 'RLS is on');

-- ── anon ───────────────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon', 'public.request_reach_out()', 'EXECUTE'), 'anon cannot ask');
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT throws_ok($$SELECT public.request_reach_out()$$, '42501', NULL, 'anon is refused');
RESET ROLE;

-- ── free, attached: refused ────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"cf000000-0000-0000-0000-000000000001","email":"ro-free@example.com","role":"authenticated"}', true);
SELECT throws_ok($$SELECT public.request_reach_out()$$, '42501', 'members_only', 'a free account is refused (it is offered booking instead)');
SELECT set_config('request.jwt.claims', '{"sub":"cf000000-0000-0000-0000-000000000003","email":"ro-org@example.com","role":"authenticated"}', true);
SELECT throws_ok($$SELECT public.request_reach_out()$$, '42501', 'attached_account', 'an attached account is refused: its own team reaches out');

-- ── member: allowed, one push per owner ────────────────────────────────────
SELECT set_config('request.jwt.claims', '{"sub":"cf000000-0000-0000-0000-000000000002","email":"ro-member@example.com","role":"authenticated"}', true);
SELECT is(public.request_reach_out(), '{"ok": true, "already": false}'::jsonb, 'a member''s request is accepted');
-- Admin functions are refused for a member.
SELECT throws_ok($$SELECT * FROM public.admin_reach_out_requests()$$, 'P0001', 'not authorized', 'a member cannot list requests');
SELECT throws_ok($$SELECT * FROM public.admin_reach_out_requests(false)$$, 'P0001', 'not authorized', 'nor the full list');
SELECT throws_ok($$SELECT * FROM public.admin_mark_reach_out_handled(gen_random_uuid())$$, 'P0001', 'not authorized', 'a member cannot mark one done');
-- 24-hour repeat: ok again, no second request and no second push.
SELECT is(public.request_reach_out(), '{"ok": true, "already": true}'::jsonb, 'a repeat within a day says ok, already asked');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM public.reach_out_requests WHERE account_id = 'cf100000-0000-0000-0000-000000000002'), 1,
  'one open request');
SELECT ok((SELECT n FROM ro_owners) >= 1, 'there is an active owner to tell');
SELECT is((SELECT count(*)::int FROM public.push_outbox WHERE kind = 'admin_reach_out'
           AND metadata->>'member_account_id' = 'cf100000-0000-0000-0000-000000000002'),
  (SELECT n FROM ro_owners), 'one push per active owner, and no second push on the repeat');
SELECT is((SELECT title || ' / ' || body FROM public.push_outbox WHERE kind = 'admin_reach_out'
           AND account_id = 'cf100000-0000-0000-0000-0000000000ff'),
  '💬 A member asked you to reach out / Dana would like you to reach out. Open Admin to see the request.',
  'first name only: nothing she answered');
SELECT is((SELECT metadata - 'request_id' FROM public.push_outbox WHERE kind = 'admin_reach_out'
           AND account_id = 'cf100000-0000-0000-0000-0000000000ff'),
  '{"kind":"admin_reach_out","member_account_id":"cf100000-0000-0000-0000-000000000002"}'::jsonb, 'the routed payload');
SELECT is((SELECT (metadata->>'request_id')::uuid FROM public.push_outbox WHERE kind = 'admin_reach_out'
           AND account_id = 'cf100000-0000-0000-0000-0000000000ff'),
  (SELECT id FROM public.reach_out_requests WHERE account_id = 'cf100000-0000-0000-0000-000000000002'), 'the payload names the request');
SELECT ok((SELECT idempotency_key FROM public.push_outbox WHERE kind = 'admin_reach_out'
           AND account_id = 'cf100000-0000-0000-0000-0000000000ff') LIKE 'reach-out:%:cf100000-0000-0000-0000-0000000000ff',
  'an idempotency key per request and owner');

-- ── Delivery: the owner gets it while the request is open ─────────────────
UPDATE public.push_outbox SET processing_token = 'cf300000-0000-0000-0000-000000000001', processing_at = now()
WHERE kind = 'admin_reach_out' AND account_id = 'cf100000-0000-0000-0000-0000000000ff';
SELECT is((SELECT public.dispatcher_outbox_delivery(o.id, 'cf300000-0000-0000-0000-000000000001') ->> 'push_token'
           FROM public.push_outbox o WHERE o.kind = 'admin_reach_out' AND o.account_id = 'cf100000-0000-0000-0000-0000000000ff'),
  'ExponentPushToken[ro-owner]', 'the dispatcher delivers an open request to the owner');

-- ── Admin: lists and marks done ───────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"cf000000-0000-0000-0000-0000000000ff","email":"matt@soberhelpline.com","role":"authenticated"}', true);
SELECT is((SELECT first_name || ' ' || email FROM public.admin_reach_out_requests()
           WHERE account_id = 'cf100000-0000-0000-0000-000000000002'),
  'Dana ro-member@example.com', 'the admin sees the open request');
SELECT ok((SELECT handled_at FROM public.admin_mark_reach_out_handled(
             (SELECT id FROM public.admin_reach_out_requests() WHERE account_id = 'cf100000-0000-0000-0000-000000000002'))) IS NOT NULL,
  'Done marks it handled');
SELECT is((SELECT count(*)::int FROM public.admin_reach_out_requests() WHERE account_id = 'cf100000-0000-0000-0000-000000000002'), 0,
  'it leaves the open list');
SELECT is((SELECT count(*)::int FROM public.admin_reach_out_requests(false) WHERE account_id = 'cf100000-0000-0000-0000-000000000002'), 1,
  'and stays in the full list');
SELECT throws_ok($$SELECT * FROM public.admin_mark_reach_out_handled('cf400000-0000-0000-0000-000000000009')$$, 'P0002', 'not_found',
  'an unknown request is reported');
RESET ROLE;

SELECT is((SELECT public.dispatcher_outbox_delivery(o.id, 'cf300000-0000-0000-0000-000000000001')
           FROM public.push_outbox o WHERE o.kind = 'admin_reach_out' AND o.account_id = 'cf100000-0000-0000-0000-0000000000ff'),
  NULL::jsonb, 'a handled request is no longer pushed');

-- After it was handled she may ask again (a new request, a new push).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"cf000000-0000-0000-0000-000000000002","email":"ro-member@example.com","role":"authenticated"}', true);
SELECT is(public.request_reach_out(), '{"ok": true, "already": false}'::jsonb, 'a new request after the last one was handled');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.push_outbox WHERE kind = 'admin_reach_out'
           AND metadata->>'member_account_id' = 'cf100000-0000-0000-0000-000000000002'),
  2 * (SELECT n FROM ro_owners), 'one more push per owner');

SELECT * FROM finish();
ROLLBACK;
