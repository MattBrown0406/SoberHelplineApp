BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(6);

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role) VALUES
  ('19100000-0000-0000-0000-000000000001','hour-member@example.com','{}','{"first_name":"Hour"}','authenticated','authenticated'),
  ('19100000-0000-0000-0000-000000000002','hour-other@example.com','{}','{"first_name":"Other"}','authenticated','authenticated');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"19100000-0000-0000-0000-000000000001","email":"hour-member@example.com","role":"authenticated"}',true);

SELECT lives_ok($$SELECT public.set_daily_push_hour(18)$$, 'a member sets her daily reminder hour');
SELECT is((SELECT daily_push_hour FROM public.accounts WHERE user_id=auth.uid()), 18::smallint, 'she can read it back');
SELECT throws_ok($$SELECT public.set_daily_push_hour(24)$$, '22023', 'invalid_preference', 'out-of-range hours are rejected');
SELECT throws_ok($$UPDATE public.accounts SET daily_push_hour=8 WHERE user_id=auth.uid()$$, '42501', NULL, 'only the RPC writes it');

RESET ROLE;
SELECT is((SELECT daily_push_hour FROM public.accounts WHERE user_id='19100000-0000-0000-0000-000000000002'), NULL::smallint, 'another account is untouched');
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.set_daily_push_hour(8)$$, '42501', NULL, 'anon cannot call it');

SELECT * FROM finish();
ROLLBACK;
