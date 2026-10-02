BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(10);

-- Two Essential members, each with a pending one-off plan review.
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role) VALUES
 ('65000000-0000-0000-0000-000000000001','mp-member@example.com','{}','{}','authenticated','authenticated'),
 ('65000000-0000-0000-0000-000000000002','mp-lapsed@example.com','{}','{}','authenticated','authenticated');
UPDATE public.accounts SET id = ('66000000-0000-0000-0000-' || right(user_id::text, 12))::uuid, type = 'direct', timezone = 'America/Chicago'
WHERE user_id::text LIKE '65000000-0000-0000-0000-0000000000%';
INSERT INTO public.entitlements(account_id, source, tier, expires_at) VALUES
 ('66000000-0000-0000-0000-000000000001', 'revenuecat', 'essential', now() + interval '30 days'),
 ('66000000-0000-0000-0000-000000000002', 'revenuecat', 'essential', now() + interval '30 days');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SELECT request_plan_review_video_session(now()+interval '4 days','America/Chicago',60,'plan_review',NULL,'[]','{safetyPlan}'::text[],'{"schemaVersion":"1","sections":{"safetyPlan":{}}}'::jsonb,'I choose to share this plan. This is not an emergency service.','en','one_off_150');
SELECT set_config('request.jwt.claims','{"sub":"65000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SELECT request_plan_review_video_session(now()+interval '4 days 2 hours','America/Chicago',60,'plan_review',NULL,'[]','{safetyPlan}'::text[],'{"schemaVersion":"1","sections":{"safetyPlan":{}}}'::jsonb,'I choose to share this plan. This is not an emergency service.','en','one_off_150');
SELECT throws_ok($$SELECT service_plan_review_checkout_cents((SELECT id FROM video_sessions WHERE account_id = '66000000-0000-0000-0000-000000000001'), true)$$,
  '42501', NULL, 'members cannot set their own price');
RESET ROLE;
-- Member 2's Essential lapses after booking (plan reviews need Essential to book).
UPDATE public.entitlements SET expires_at = now() - interval '1 minute' WHERE account_id = '66000000-0000-0000-0000-000000000002';
SELECT ok(NOT has_function_privilege('anon', 'public.service_plan_review_checkout_cents(uuid,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.service_plan_review_checkout_cents(uuid,boolean)', 'EXECUTE'),
  'the price function is service-role only');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(service_plan_review_checkout_cents((SELECT id FROM video_sessions WHERE account_id = '66000000-0000-0000-0000-000000000001'), false), 15000,
  'before the member price is switched on, everyone is quoted $150');
SELECT throws_ok($$SELECT apply_plan_review_payment_event('capture.member.early', (SELECT id FROM video_sessions WHERE account_id = '66000000-0000-0000-0000-000000000001'),
  'ORDER-MP-0', 'CAPTURE-MP-0', 'captured', 12500, 'USD', now())$$, 'P0001', 'invalid_payment_event',
  'a $125 capture is refused for a session never quoted the member price');
SELECT is(service_plan_review_checkout_cents((SELECT id FROM video_sessions WHERE account_id = '66000000-0000-0000-0000-000000000001'), true), 12500,
  'a paying member is quoted $125');
SELECT is(service_plan_review_checkout_cents((SELECT id FROM video_sessions WHERE account_id = '66000000-0000-0000-0000-000000000002'), true), 15000,
  'a member whose Essential lapsed is quoted $150');
RESET ROLE;
SELECT ok((SELECT plan_review_member_quote FROM video_sessions WHERE account_id = '66000000-0000-0000-0000-000000000001')
  AND NOT (SELECT plan_review_member_quote FROM video_sessions WHERE account_id = '66000000-0000-0000-0000-000000000002'),
  'only the member''s session remembers the member quote');

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT lives_ok($$SELECT apply_plan_review_payment_event('capture.member.ok', (SELECT id FROM video_sessions WHERE account_id = '66000000-0000-0000-0000-000000000001'),
  'ORDER-MP-1', 'CAPTURE-MP-1', 'captured', 12500, 'USD', now())$$, 'the member''s $125 capture is accepted');
SELECT throws_ok($$SELECT apply_plan_review_payment_event('capture.free.bad', (SELECT id FROM video_sessions WHERE account_id = '66000000-0000-0000-0000-000000000002'),
  'ORDER-MP-2', 'CAPTURE-MP-2', 'captured', 12500, 'USD', now())$$, 'P0001', 'invalid_payment_event',
  'a lapsed member''s session cannot be paid at the member price');
RESET ROLE;
SELECT is((SELECT payment_status FROM video_sessions WHERE account_id = '66000000-0000-0000-0000-000000000001'), 'paid',
  'the member''s review is paid');

SELECT * FROM finish();
ROLLBACK;
