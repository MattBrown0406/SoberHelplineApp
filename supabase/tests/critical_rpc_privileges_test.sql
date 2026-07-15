BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(18);

SELECT ok(NOT has_function_privilege('anon','public.admin_get_active_threads()','EXECUTE'),'anon cannot read admin inbox');
SELECT ok(NOT has_function_privilege('anon','public.moderate_community_post(uuid,text)','EXECUTE'),'anon cannot moderate community');
SELECT ok(NOT has_function_privilege('anon','public.get_thread_member_info(uuid)','EXECUTE'),'anon cannot read member push target');
SELECT ok(NOT has_function_privilege('anon','public.get_account_push_token_by_email(text)','EXECUTE'),'anon cannot resolve push token by email');
SELECT ok(NOT has_function_privilege('authenticated','public.get_thread_member_info(uuid)','EXECUTE'),'members cannot read member push target');
SELECT ok(NOT has_function_privilege('authenticated','public.get_account_push_token_by_email(text)','EXECUTE'),'members cannot resolve push token by email');
SELECT ok(has_function_privilege('service_role','public.get_thread_member_info(uuid)','EXECUTE'),'service role can resolve webhook push target');
SELECT ok(has_function_privilege('service_role','public.get_account_push_token_by_email(text)','EXECUTE'),'service role can resolve coach push target');
SELECT ok(has_function_privilege('authenticated','public.admin_get_active_threads()','EXECUTE'),'authenticated staff can call inbox RPC');
SELECT ok(has_function_privilege('authenticated','public.moderate_community_post(uuid,text)','EXECUTE'),'authenticated owner can call moderation RPC');
SELECT ok(has_table_privilege('authenticated','public.entitlements','SELECT'),'authenticated can select own entitlements through RLS');
SELECT ok(has_table_privilege('authenticated','public.video_sessions','SELECT'),'authenticated can select permitted video sessions through RLS');
SELECT ok(has_table_privilege('authenticated','public.coaching_bookings','SELECT'),'authenticated can select own coaching bookings through RLS');
SELECT ok(has_table_privilege('authenticated','public.coaching_bookings','INSERT'),'authenticated can insert constrained coaching bookings through RLS');
SELECT ok(has_table_privilege('service_role','public.accounts','SELECT'),'service role can resolve account for RevenueCat synchronization');
SELECT ok(has_table_privilege('service_role','public.entitlements','SELECT'),'service role can verify RevenueCat mirror state');

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role)
VALUES ('12000000-0000-0000-0000-000000000001','ordinary-member@example.com','{}','{}','authenticated','authenticated');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"12000000-0000-0000-0000-000000000001","email":"ordinary-member@example.com","role":"authenticated"}',true);
SELECT throws_ok($$SELECT * FROM public.admin_get_active_threads()$$,'P0001','not_authorized','ordinary member cannot read admin inbox');
SELECT throws_ok($$SELECT public.moderate_community_post(NULL,'removed')$$,'P0001','not_authorized','ordinary member cannot moderate community');

SELECT * FROM finish();
ROLLBACK;
