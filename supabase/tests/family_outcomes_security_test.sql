BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(23);

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role)
VALUES
  ('67000000-0000-0000-0000-000000000001','outcome-owner@example.com','{}','{"first_name":"Owner"}','authenticated','authenticated'),
  ('67000000-0000-0000-0000-000000000002','outcome-other@example.com','{}','{"first_name":"Other"}','authenticated','authenticated');

SELECT ok(
  has_table_privilege('authenticated','public.family_outcomes','SELECT')
  AND NOT has_table_privilege('authenticated','public.family_outcomes','INSERT')
  AND NOT has_table_privilege('authenticated','public.family_outcomes','UPDATE')
  AND NOT has_table_privilege('authenticated','public.family_outcomes','DELETE'),
  'authenticated may select but cannot mutate family outcomes directly'
);
SELECT ok(NOT has_table_privilege('anon','public.family_outcomes','SELECT'), 'anonymous users cannot read outcomes');
SELECT ok(
  has_function_privilege('authenticated','public.record_family_outcome(uuid,text,date,text,text,text)','EXECUTE')
  AND has_function_privilege('authenticated','public.update_family_outcome(uuid,text,date,text,text,text)','EXECUTE')
  AND has_function_privilege('authenticated','public.delete_family_outcome(uuid)','EXECUTE'),
  'authenticated users can call the validated mutation RPCs'
);
SELECT ok(
  NOT has_function_privilege('anon','public.record_family_outcome(uuid,text,date,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.update_family_outcome(uuid,text,date,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public.delete_family_outcome(uuid)','EXECUTE'),
  'anonymous users cannot call outcome mutation RPCs'
);
SELECT ok(
  NOT has_function_privilege('service_role','public.record_family_outcome(uuid,text,date,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.update_family_outcome(uuid,text,date,text,text,text)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.delete_family_outcome(uuid)','EXECUTE')
  AND NOT has_function_privilege('service_role','public.admin_family_outcome_counts()','EXECUTE'),
  'service role RPC execution is intentionally denied; admin reporting requires an authenticated admin JWT'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"67000000-0000-0000-0000-000000000001","email":"outcome-owner@example.com","role":"authenticated"}',true);
SELECT lives_ok(
  $$SELECT public.record_family_outcome(
    '67000000-0000-0000-0000-000000000101','entered_care',current_date - 1,
    'residential','planned_intervention','Family held the agreed boundary.'
  )$$,
  'owner can record a validated outcome'
);
SELECT is((SELECT count(*)::integer FROM public.family_outcomes), 1, 'owner sees the new outcome');
SELECT is((SELECT pathway_note FROM public.family_outcomes LIMIT 1), 'Family held the agreed boundary.', 'owner can read the bounded private note');
SELECT lives_ok(
  $$SELECT public.record_family_outcome(
    '67000000-0000-0000-0000-000000000101','entered_care',current_date - 1,
    'residential','planned_intervention','Family held the agreed boundary.'
  )$$,
  'an identical client retry is idempotent'
);
SELECT is((SELECT count(*)::integer FROM public.family_outcomes), 1, 'idempotent retry creates no duplicate');
SELECT throws_ok(
  $$SELECT public.record_family_outcome(
    '67000000-0000-0000-0000-000000000101','completed_care',current_date - 1,
    'outpatient','self_initiated',NULL
  )$$,
  '23505','family_outcome_client_event_conflict','conflicting reuse of a client event id fails closed'
);
SELECT throws_ok(
  $$SELECT public.record_family_outcome(
    '67000000-0000-0000-0000-000000000102','entered_care',current_date + 1,
    'residential','planned_intervention',NULL
  )$$,
  '22023','invalid_family_outcome_date','future outcome dates are rejected'
);
SELECT throws_ok(
  $$SELECT public.record_family_outcome(
    '67000000-0000-0000-0000-000000000103','diagnosed',current_date - 1,
    'residential','planned_intervention',NULL
  )$$,
  '22023','invalid_family_outcome_event','event values are allowlisted'
);
SELECT throws_ok(
  $$INSERT INTO public.family_outcomes(account_id,client_event_id,event,occurred_on,level_of_care,pathway)
    VALUES(public.my_account_id(),'67000000-0000-0000-0000-000000000104','entered_care',current_date - 1,'residential','planned_intervention')$$,
  '42501','permission denied for table family_outcomes','clients cannot spoof account ownership with a direct insert'
);
SELECT set_config(
  'test.owner_outcome_id',
  (SELECT id::text FROM public.family_outcomes WHERE client_event_id='67000000-0000-0000-0000-000000000101'),
  false
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"67000000-0000-0000-0000-000000000002","email":"outcome-other@example.com","role":"authenticated"}',true);
SELECT is((SELECT count(*)::integer FROM public.family_outcomes), 0, 'another account cannot see the owner outcome');
SELECT throws_ok(
  $$SELECT public.update_family_outcome(
    current_setting('test.owner_outcome_id')::uuid,'completed_care',current_date - 1,
    'outpatient','self_initiated',NULL
  )$$,
  'P0002','family_outcome_not_found','another account cannot update the owner outcome'
);
SELECT is(
  public.delete_family_outcome(current_setting('test.owner_outcome_id')::uuid),
  true,
  'delete is idempotent and does not reveal whether another account owns the identifier'
);
SELECT lives_ok(
  $$SELECT public.record_family_outcome(
    '67000000-0000-0000-0000-000000000202','entered_care',current_date - 1,
    'intensive_outpatient','clinician_referral',NULL
  )$$,
  'second account can record its own outcome'
);
SELECT is((SELECT count(*)::integer FROM public.family_outcomes), 1, 'second account sees only its own outcome');
SELECT throws_ok(
  $$SELECT * FROM public.admin_family_outcome_counts()$$,
  '42501','not_authorized','ordinary members cannot read aggregate outcome reporting'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"67000000-0000-0000-0000-000000000001","email":"outcome-owner@example.com","role":"authenticated"}',true);
SELECT is(public.delete_family_outcome(current_setting('test.owner_outcome_id')::uuid), true, 'owner can delete their own outcome through the RPC');
SELECT is((SELECT count(*)::integer FROM public.family_outcomes), 0, 'deleted owner outcome is no longer visible');

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"67000000-0000-0000-0000-000000000001","email":"matt@soberhelpline.com","role":"authenticated"}',true);
SELECT is((SELECT sum(outcome_count)::integer FROM public.admin_family_outcome_counts()), 1, 'authorized admin can read de-identified aggregate counts');

SELECT * FROM finish();
ROLLBACK;
