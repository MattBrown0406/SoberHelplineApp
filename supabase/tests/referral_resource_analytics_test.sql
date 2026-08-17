BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(10);

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
VALUES ('62000000-0000-0000-0000-000000000001', 'resource-member@example.com', '{}', '{}', 'authenticated', 'authenticated');

SELECT ok(
  has_function_privilege('authenticated', 'public.log_funnel_event(text,jsonb)', 'EXECUTE'),
  'authenticated members can log privacy-safe distribution events'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.log_funnel_event(text,jsonb)', 'EXECUTE'),
  'anonymous callers cannot execute distribution analytics RPC'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.admin_referral_resource_stats()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_referral_resource_stats()', 'EXECUTE'),
  'referral stats RPC is granted only to authenticated callers and checks admin JWT internally'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"62000000-0000-0000-0000-000000000001","role":"authenticated","email":"resource-member@example.com"}',
  true
);

SELECT lives_ok(
  $$SELECT public.log_funnel_event('monday_call_share_requested', '{"language":"en","private_note":"must be dropped"}'::jsonb)$$,
  'member can log a Monday call share request'
);
SELECT lives_ok(
  $$SELECT public.log_funnel_event('boundary_card_print_requested', '{"language":"es"}'::jsonb)$$,
  'member can log a boundary-card print request'
);
SELECT is(
  (SELECT count(*)::integer FROM public.funnel_events
    WHERE account_id=public.my_account_id()
      AND stage IN ('monday_call_share_requested','boundary_card_print_requested')),
  2,
  'both distribution events are account-scoped and persisted'
);
SELECT is(
  (SELECT metadata FROM public.funnel_events
    WHERE account_id=public.my_account_id() AND stage='monday_call_share_requested'
    ORDER BY created_at DESC LIMIT 1),
  '{"language":"en"}'::jsonb,
  'database strips unapproved metadata from distribution events'
);
SELECT throws_ok(
  $$SELECT public.log_funnel_event('resource_shared_with_private_notes', '{}'::jsonb)$$,
  'P0001',
  'bad_stage',
  'unapproved or content-bearing event stages are rejected'
);
SELECT throws_ok(
  $$SELECT public.admin_referral_resource_stats()$$,
  'P0001',
  'not authorized',
  'ordinary members cannot read aggregate referral analytics'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"62000000-0000-0000-0000-000000000001","role":"authenticated","email":"matt@soberhelpline.com"}',
  true
);
SELECT is(
  (public.admin_referral_resource_stats() ->> 'monday_call_share_requests')::integer,
  1,
  'admin referral stats report the persisted Monday call share request'
);

SELECT * FROM finish();
ROLLBACK;
