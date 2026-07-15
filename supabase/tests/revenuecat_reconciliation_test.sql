BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(7);

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role)
VALUES ('13000000-0000-0000-0000-000000000001','revenuecat-test@example.com','{}','{}','authenticated','authenticated');

SELECT ok(NOT has_function_privilege('anon','public.reconcile_revenuecat_entitlements(uuid,jsonb)','EXECUTE'),'anon cannot reconcile RevenueCat access');
SELECT ok(NOT has_function_privilege('authenticated','public.reconcile_revenuecat_entitlements(uuid,jsonb)','EXECUTE'),'members cannot reconcile RevenueCat access');
SELECT ok(has_function_privilege('service_role','public.reconcile_revenuecat_entitlements(uuid,jsonb)','EXECUTE'),'service role can reconcile RevenueCat access');

SET LOCAL ROLE service_role;
SELECT lives_ok($$SELECT public.reconcile_revenuecat_entitlements(
  (SELECT id FROM public.accounts WHERE user_id='13000000-0000-0000-0000-000000000001'),
  jsonb_build_object('essential',(now()+interval '30 days')::text)
)$$,'valid RevenueCat mirror is accepted');
SELECT is((SELECT count(*)::int FROM public.entitlements WHERE account_id=(SELECT id FROM public.accounts WHERE user_id='13000000-0000-0000-0000-000000000001') AND source='revenuecat'),1,'one mirrored grant is stored');
SELECT throws_ok($$SELECT public.reconcile_revenuecat_entitlements(
  (SELECT id FROM public.accounts WHERE user_id='13000000-0000-0000-0000-000000000001'),
  jsonb_build_object('forged_tier',(now()+interval '30 days')::text)
)$$,'P0001','invalid_entitlement_tier','unknown tier is rejected');
SELECT is((SELECT tier FROM public.entitlements WHERE account_id=(SELECT id FROM public.accounts WHERE user_id='13000000-0000-0000-0000-000000000001') AND source='revenuecat'),'essential','failed reconciliation preserves prior access');

SELECT * FROM finish();
ROLLBACK;
