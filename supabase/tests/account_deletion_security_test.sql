BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(4);

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role)
VALUES ('12000000-0000-0000-0000-000000000001','delete-owner@example.com','{}','{}','authenticated','authenticated');

SELECT ok(
  NOT has_function_privilege('anon','public.delete_own_account()','EXECUTE'),
  'anonymous callers cannot execute account deletion'
);
SELECT ok(
  has_function_privilege('authenticated','public.delete_own_account()','EXECUTE'),
  'authenticated callers can execute account deletion'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"12000000-0000-0000-0000-000000000001","email":"delete-owner@example.com","role":"authenticated"}',true);
SELECT lives_ok(
  $$SELECT public.delete_own_account()$$,
  'authenticated member can delete their own account'
);
RESET ROLE;

SELECT is(
  (SELECT count(*)::integer FROM auth.users WHERE id='12000000-0000-0000-0000-000000000001'),
  0,
  'successful deletion removes the auth user row'
);

SELECT * FROM finish();
ROLLBACK;
