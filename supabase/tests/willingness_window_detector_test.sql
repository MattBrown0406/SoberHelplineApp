BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(14);

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
VALUES
  ('68000000-0000-0000-0000-000000000001', 'window-owner@example.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('68000000-0000-0000-0000-000000000002', 'window-other@example.com', '{}', '{}', 'authenticated', 'authenticated');

INSERT INTO public.consequence_events (account_id, event_type, occurred_at)
VALUES (
  (SELECT id FROM public.accounts WHERE user_id='68000000-0000-0000-0000-000000000001'),
  'legal',
  now() - interval '4 days'
);

SELECT ok(
  has_table_privilege('authenticated','public.consequence_events','SELECT')
  AND has_table_privilege('authenticated','public.consequence_events','DELETE')
  AND NOT has_table_privilege('authenticated','public.consequence_events','INSERT')
  AND NOT has_table_privilege('authenticated','public.consequence_events','UPDATE'),
  'members can read and remove their events but must use the validated logging RPC'
);
SELECT ok(
  has_function_privilege('authenticated','public.log_consequence_event(text,timestamptz)','EXECUTE'),
  'members can call the validated consequence logger'
);
SELECT ok(
  NOT has_table_privilege('anon','public.consequence_events','SELECT')
  AND NOT has_function_privilege('anon','public.log_consequence_event(text,timestamptz)','EXECUTE'),
  'anonymous clients cannot access consequence events'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"68000000-0000-0000-0000-000000000001","role":"authenticated"}',true);

SELECT lives_ok(
  $$SELECT public.log_consequence_event('medical', now() - interval '1 hour')$$,
  'owner can log a fresh consequence'
);
SELECT is(
  (SELECT count(*)::integer FROM public.consequence_events),
  2,
  'owner sees their active and expired events'
);
SELECT is(
  (public.my_situation()->'drivers'->>'willingness_window_active')::boolean,
  true,
  'fresh consequence opens the willingness window in my_situation'
);
SELECT is(
  public.my_situation()->'drivers'->>'latest_consequence_type',
  'medical',
  'my_situation exposes the latest consequence type'
);
SELECT ok(
  (public.my_situation()->>'score')::integer >= 30,
  'an active willingness window immediately changes situation posture'
);
SELECT throws_ok(
  $$SELECT public.log_consequence_event('warning', now())$$,
  '22023',
  'invalid_consequence_type',
  'logger rejects non-consequence tracker kinds'
);
SELECT throws_ok(
  $$SELECT public.log_consequence_event('legal', now() + interval '6 minutes')$$,
  '22023',
  'invalid_consequence_time',
  'logger rejects future event times'
);
SELECT throws_ok(
  $$SELECT public.log_consequence_event('legal', now() - interval '31 days')$$,
  '22023',
  'invalid_consequence_time',
  'logger rejects stale event times'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"68000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SELECT is(
  (SELECT count(*)::integer FROM public.consequence_events),
  0,
  'another member cannot see the owner consequence events'
);
SELECT lives_ok(
  $$DELETE FROM public.consequence_events$$,
  'another member delete is safely constrained by RLS'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"68000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
DELETE FROM public.consequence_events WHERE event_type='medical';
SELECT is(
  (public.my_situation()->'drivers'->>'willingness_window_active')::boolean,
  false,
  'expired consequence remains historical but does not keep the window open'
);

SELECT * FROM finish();
ROLLBACK;
