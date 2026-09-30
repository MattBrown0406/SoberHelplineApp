BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(7);

SELECT ok(NOT has_function_privilege('anon','public.consume_rehearsal_quota(text)','EXECUTE'),
  'anon cannot spend AI practice quota');
SELECT ok(has_function_privilege('authenticated','public.consume_rehearsal_quota(text)','EXECUTE'),
  'members can spend their own AI practice quota');
SELECT ok(NOT has_table_privilege('authenticated','public.rehearsal_usage','SELECT')
  AND NOT has_table_privilege('authenticated','public.rehearsal_usage','UPDATE'),
  'members cannot read or reset usage counters directly');

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role)
VALUES ('13000000-0000-0000-0000-000000000001','quota-member@example.com','{}','{}','authenticated','authenticated');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"13000000-0000-0000-0000-000000000001","email":"quota-member@example.com","role":"authenticated"}',true);

SELECT ok(public.consume_rehearsal_quota('debrief'), 'first debrief of the day is allowed');
SELECT ok(NOT public.consume_rehearsal_quota('bogus'), 'unknown modes are refused');

-- Burn the remaining 29 debriefs, then the 31st must be refused.
DO $$ BEGIN PERFORM public.consume_rehearsal_quota('debrief') FROM generate_series(1, 29); END $$;
SELECT ok(NOT public.consume_rehearsal_quota('debrief'), 'debrief cap is enforced after 30 per day');
SELECT ok(public.consume_rehearsal_quota('reply'), 'caps are tracked per mode');

SELECT * FROM finish();
ROLLBACK;
