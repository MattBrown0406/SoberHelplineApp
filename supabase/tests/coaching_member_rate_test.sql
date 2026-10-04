BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT no_plan();

INSERT INTO auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role) VALUES
 ('ab000000-0000-0000-0000-000000000001','rate-member@example.com',now(),'{}','{}','authenticated','authenticated'),
 ('ab000000-0000-0000-0000-000000000002','rate-free@example.com',now(),'{}','{}','authenticated','authenticated'),
 ('ab000000-0000-0000-0000-000000000003','rate-org@example.com',now(),'{}','{}','authenticated','authenticated');
UPDATE public.accounts SET id = ('ab100000-0000-0000-0000-' || right(user_id::text, 12))::uuid
WHERE user_id::text LIKE 'ab000000-0000-0000-0000-0000000000%';
INSERT INTO public.entitlements(account_id, source, tier, expires_at) VALUES
 ('ab100000-0000-0000-0000-000000000001', 'revenuecat', 'essential', now() + interval '30 days');
INSERT INTO public.orgs(id, name, status) VALUES ('ab200000-0000-0000-0000-000000000001', 'Rate Test Org', 'active');
UPDATE public.accounts SET type = 'attached', org_id = 'ab200000-0000-0000-0000-000000000001'
WHERE id = 'ab100000-0000-0000-0000-000000000003';

-- ── Manual coaching request: the server records the member quote ────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"ab000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SELECT lives_ok($$INSERT INTO coaching_bookings(account_id, preferred_times) VALUES (my_account_id(), 'Tue · Morning')$$,
  'a paying member requests coaching');
SELECT lives_ok($$INSERT INTO coaching_bookings(account_id, preferred_times, rate_cents) VALUES (my_account_id(), 'Wed · Morning', 15000)$$,
  'an old client that sends the standard rate is still accepted');
SELECT is((SELECT array_agg(DISTINCT rate_cents) FROM coaching_bookings WHERE account_id = my_account_id()), ARRAY[12500],
  'a member''s request is recorded at the $125 member price');

SELECT set_config('request.jwt.claims','{"sub":"ab000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SELECT lives_ok($$INSERT INTO coaching_bookings(account_id, preferred_times, rate_cents) VALUES (my_account_id(), 'Thu · Evening', 12500)$$,
  'a free account cannot pick the member price (the value is ignored)');
SELECT is((SELECT rate_cents FROM coaching_bookings WHERE account_id = my_account_id()), 15000, 'a free account is recorded at $150');
SELECT throws_ok($$INSERT INTO coaching_bookings(account_id, preferred_times, status) VALUES (my_account_id(), 'Fri', 'confirmed')$$,
  '42501', NULL, 'members still cannot confirm their own booking');

SELECT set_config('request.jwt.claims','{"sub":"ab000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SELECT lives_ok($$INSERT INTO coaching_bookings(account_id, preferred_times) VALUES (my_account_id(), 'Sat · Morning')$$,
  'an active provider-org member requests coaching');
SELECT is((SELECT rate_cents FROM coaching_bookings WHERE account_id = my_account_id()), 12500, 'org members get the member price');
RESET ROLE;

SELECT is((SELECT (payload->'props'->>'rate_cents')::integer FROM spine_outbox
           WHERE event_name = 'session_booked' AND payload->'props'->>'booking_id' =
             (SELECT id::text FROM coaching_bookings WHERE preferred_times = 'Tue · Morning')),
  12500, 'the hub hears the member price');

-- A booking marked paid by hand reports the recorded rate to the hub.
UPDATE coaching_bookings SET payment_status = 'paid' WHERE preferred_times = 'Tue · Morning';
SELECT is((SELECT (payload->'payment'->>'amount_cents')::integer FROM spine_outbox
           WHERE event_name = 'payment' AND payload->'payment'->>'id' =
             (SELECT id::text || '_coaching' FROM coaching_bookings WHERE preferred_times = 'Tue · Morning')),
  12500, 'a manual payment is valued at the member price');

-- Server-created plan-review records keep the rate the server set.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"ab000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SELECT request_plan_review_video_session(now()+interval '4 days','America/Chicago',60,'plan_review',NULL,'[]','{safetyPlan}'::text[],
  '{"schemaVersion":"1","sections":{"safetyPlan":{}}}'::jsonb,'I choose to share this plan. This is not an emergency service.','en','one_off_150');
RESET ROLE;
SELECT is((SELECT rate_cents FROM coaching_bookings WHERE account_id = 'ab100000-0000-0000-0000-000000000001' AND note = 'Plan review video session'),
  15000, 'a plan-review payment record keeps its server-set rate (the checkout quotes the price)');

-- ── Membership export includes active provider-org members ───────────────────
SELECT results_eq(
  $$SELECT email, tier, expires_at FROM service_membership_export(NULL, 1000) WHERE email LIKE 'rate-%' ORDER BY email$$,
  $$VALUES ('rate-member@example.com', 'essential', now() + interval '30 days'), ('rate-org@example.com', 'org', NULL::timestamptz)$$,
  'an active provider-org member is exported as org');
UPDATE orgs SET status = 'suspended' WHERE id = 'ab200000-0000-0000-0000-000000000001';
SELECT is((SELECT count(*)::integer FROM service_membership_export(NULL, 1000) WHERE email = 'rate-org@example.com'), 0,
  'a suspended organization''s members are not');

SELECT * FROM finish();
ROLLBACK;
