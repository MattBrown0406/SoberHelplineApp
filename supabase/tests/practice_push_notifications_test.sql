BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(32);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid='public.practice_push_preferences'::regclass),
  'practice push preferences use RLS'
);
SELECT ok(
  has_table_privilege('authenticated','public.practice_push_preferences','SELECT')
  AND has_column_privilege('authenticated','public.practice_push_preferences','account_id','INSERT')
  AND has_column_privilege('authenticated','public.practice_push_preferences','account_id','UPDATE')
  AND has_column_privilege('authenticated','public.practice_push_preferences','enabled','UPDATE'),
  'authenticated members can read and edit the allowed preference fields'
);
SELECT ok(
  NOT has_column_privilege('authenticated','public.practice_push_preferences','next_prompt_at','INSERT')
  AND NOT has_column_privilege('authenticated','public.practice_push_preferences','next_prompt_at','UPDATE')
  AND NOT has_column_privilege('authenticated','public.practice_push_preferences','last_enqueued_at','UPDATE'),
  'members cannot control scheduler-owned fields'
);
SELECT ok(
  NOT has_function_privilege('authenticated','public.enqueue_due_practice_pushes(timestamp with time zone)','EXECUTE')
  AND has_function_privilege('authenticated','public.register_push_device(text,text)','EXECUTE')
  AND has_function_privilege('authenticated','public.validate_practice_push_event(uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.claim_practice_push_event(uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.practice_push_delivery_ttl(uuid,uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.practice_push_delivery_ttl(uuid,uuid)','EXECUTE'),
  'members can register/validate their own device events but cannot invoke the scheduler'
);

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role)
VALUES
  ('1a000000-0000-0000-0000-000000000001','practice-paid@example.com','{}','{"first_name":"Paid"}','authenticated','authenticated'),
  ('1a000000-0000-0000-0000-000000000002','practice-free@example.com','{}','{"first_name":"Free"}','authenticated','authenticated');

UPDATE public.accounts
SET timezone='UTC', push_token=CASE
  WHEN user_id='1a000000-0000-0000-0000-000000000001' THEN 'ExponentPushToken[paid-practice]'
  ELSE 'ExponentPushToken[free-practice]'
END,
locale=CASE WHEN user_id='1a000000-0000-0000-0000-000000000001' THEN 'es' ELSE 'en' END
WHERE user_id IN ('1a000000-0000-0000-0000-000000000001','1a000000-0000-0000-0000-000000000002');

INSERT INTO public.entitlements(account_id,source,tier,expires_at)
SELECT id,'revenuecat','essential','2026-08-31T00:00:00Z'
FROM public.accounts WHERE user_id='1a000000-0000-0000-0000-000000000001';
SELECT set_config(
  'test.other_account_id',
  (SELECT id::text FROM public.accounts WHERE user_id='1a000000-0000-0000-0000-000000000002'),
  true
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"1a000000-0000-0000-0000-000000000001","email":"practice-paid@example.com","role":"authenticated"}',true);

SELECT lives_ok(
  $$SELECT public.register_push_device('ExponentPushToken[shared-practice-device-123456]','es')$$,
  'paid member can atomically register the device token'
);
SELECT is(
  (SELECT push_token FROM public.accounts WHERE id=public.my_account_id()),
  'ExponentPushToken[shared-practice-device-123456]',
  'registered token is attached to the authenticated account'
);

SELECT lives_ok(
  $$INSERT INTO public.practice_push_preferences(account_id,enabled,frequency_per_week,window_start_hour,window_end_hour)
    VALUES(public.my_account_id(),true,2,9,20)$$,
  'member can opt into practice calls for their own account'
);
SELECT lives_ok(
  $$INSERT INTO public.practice_push_preferences(account_id,enabled,frequency_per_week,window_start_hour,window_end_hour)
    VALUES(public.my_account_id(),true,3,12,17)
    ON CONFLICT (account_id) DO UPDATE SET
      account_id=EXCLUDED.account_id,
      enabled=EXCLUDED.enabled,
      frequency_per_week=EXCLUDED.frequency_per_week,
      window_start_hour=EXCLUDED.window_start_hour,
      window_end_hour=EXCLUDED.window_end_hour$$,
  'PostgREST-style upsert can update an existing own preference row'
);
SELECT throws_ok(
  $$INSERT INTO public.practice_push_preferences(account_id,enabled,frequency_per_week,window_start_hour,window_end_hour)
    VALUES(current_setting('test.other_account_id')::uuid,true,2,9,20)$$,
  '42501',
  'new row violates row-level security policy for table "practice_push_preferences"',
  'member cannot create preferences for another account'
);
SELECT throws_ok(
  $$UPDATE public.practice_push_preferences SET next_prompt_at=now() WHERE account_id=public.my_account_id()$$,
  '42501',
  'permission denied for table practice_push_preferences',
  'member cannot edit scheduler-owned timestamps'
);
SELECT is(
  (SELECT count(*)::integer FROM public.practice_push_preferences),
  1,
  'member sees their own preferences'
);

SELECT set_config('request.jwt.claims','{"sub":"1a000000-0000-0000-0000-000000000002","email":"practice-free@example.com","role":"authenticated"}',true);
SELECT lives_ok(
  $$SELECT public.register_push_device('ExponentPushToken[shared-practice-device-123456]','en')$$,
  'account switch atomically transfers the same device token'
);
SELECT is(
  (SELECT count(*)::integer FROM public.practice_push_preferences),
  0,
  'member cannot read another account preferences'
);
SELECT lives_ok(
  $$INSERT INTO public.practice_push_preferences(account_id,enabled,frequency_per_week,window_start_hour,window_end_hour)
    VALUES(public.my_account_id(),true,2,9,20)$$,
  'a free member may save an opt-in preference without receiving paid practice pushes'
);

RESET ROLE;
SELECT is(
  (SELECT user_id FROM public.accounts WHERE push_token='ExponentPushToken[shared-practice-device-123456]'),
  '1a000000-0000-0000-0000-000000000002'::uuid,
  'device token has exactly one owner after an account switch'
);
UPDATE public.accounts
SET push_token='ExponentPushToken[paid-practice-restored-123456]'
WHERE user_id='1a000000-0000-0000-0000-000000000001';

UPDATE public.practice_push_preferences
SET next_prompt_at='2026-07-28T16:00:00Z'
WHERE account_id IN (
  SELECT id FROM public.accounts WHERE user_id IN (
    '1a000000-0000-0000-0000-000000000001',
    '1a000000-0000-0000-0000-000000000002'
  )
);

SELECT is(
  public.enqueue_due_practice_pushes('2026-07-28T16:00:00Z'),
  1,
  'scheduler enqueues one due entitled practice push'
);
SELECT is(
  (SELECT count(*)::integer FROM public.push_outbox WHERE kind='practice_incoming'),
  1,
  'exactly one practice push is queued'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.push_outbox
    WHERE kind='practice_incoming'
      AND metadata->>'kind'='practice_incoming'
      AND metadata->>'screen'='rehearsal-incoming'
      AND (metadata->>'event_id')::uuid IS NOT NULL
      AND (metadata->>'expires_at')::timestamptz='2026-07-28T20:00:00Z'::timestamptz
      AND body NOT ILIKE '%practice-paid@example.com%'
  ),
  'queued payload is a privacy-safe validated deep link'
);
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.push_outbox
    WHERE kind='practice_incoming'
      AND title='Llamada de práctica entrante'
  ),
  'practice push copy follows the member locale'
);

UPDATE public.practice_push_events
SET expires_at=now() + interval '4 hours'
WHERE event_id=(SELECT (metadata->>'event_id')::uuid FROM public.push_outbox WHERE kind='practice_incoming');
SELECT set_config(
  'test.practice_event_id',
  (SELECT metadata->>'event_id' FROM public.push_outbox WHERE kind='practice_incoming'),
  true
);
SET LOCAL ROLE service_role;
SELECT ok(
  public.practice_push_delivery_ttl(
    current_setting('test.practice_event_id')::uuid,
    (SELECT id FROM public.accounts WHERE user_id='1a000000-0000-0000-0000-000000000001')
  ) BETWEEN 1 AND 14400,
  'sender receives only the remaining lifetime for an eligible active event'
);
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"1a000000-0000-0000-0000-000000000001","email":"practice-paid@example.com","role":"authenticated"}',true);
SELECT is(
  public.validate_practice_push_event(current_setting('test.practice_event_id')::uuid),
  true,
  'authenticated owner can validate their unexpired opaque practice event'
);
SELECT set_config('request.jwt.claims','{"sub":"1a000000-0000-0000-0000-000000000002","email":"practice-free@example.com","role":"authenticated"}',true);
SELECT is(
  public.validate_practice_push_event(current_setting('test.practice_event_id')::uuid),
  false,
  'a different account cannot validate another member practice event'
);
SELECT set_config('request.jwt.claims','{"sub":"1a000000-0000-0000-0000-000000000001","email":"practice-paid@example.com","role":"authenticated"}',true);
SELECT is(
  public.claim_practice_push_event(current_setting('test.practice_event_id')::uuid),
  true,
  'the authenticated owner can claim the event when answering'
);
SELECT is(
  public.claim_practice_push_event(current_setting('test.practice_event_id')::uuid),
  false,
  'the same event cannot generate a second AI opening'
);
SELECT is(
  public.validate_practice_push_event(current_setting('test.practice_event_id')::uuid),
  false,
  'answered events are rejected on later duplicate taps'
);
RESET ROLE;
SELECT ok(
  (SELECT next_prompt_at > '2026-07-28T16:00:00Z'::timestamptz
   FROM public.practice_push_preferences p
   JOIN public.accounts a ON a.id=p.account_id
   WHERE a.user_id='1a000000-0000-0000-0000-000000000001'),
  'successful enqueue advances the next prompt'
);
SELECT ok(
  (SELECT next_prompt_at >= last_enqueued_at + interval '56 hours'
   FROM public.practice_push_preferences p
   JOIN public.accounts a ON a.id=p.account_id
   WHERE a.user_id='1a000000-0000-0000-0000-000000000001'),
  'scheduler never exceeds the selected three-per-week cadence'
);
SELECT is(
  public.enqueue_due_practice_pushes('2026-07-28T16:00:00Z'),
  0,
  'rerunning the scheduler is idempotent'
);

UPDATE public.practice_push_preferences p
SET next_prompt_at='2026-01-01T16:00:00Z'
FROM public.accounts a
WHERE a.id=p.account_id AND a.user_id='1a000000-0000-0000-0000-000000000001';
SELECT is(
  public.enqueue_due_practice_pushes('2026-07-29T16:00:00Z'),
  1,
  'a stale eligible schedule produces only one catch-up prompt'
);
SELECT ok(
  (SELECT next_prompt_at > '2026-07-29T16:00:00Z'::timestamptz
   FROM public.practice_push_preferences p
   JOIN public.accounts a ON a.id=p.account_id
   WHERE a.user_id='1a000000-0000-0000-0000-000000000001'),
  'catch-up fast-forwards the next prompt into the future'
);
SELECT is(
  public.enqueue_due_practice_pushes('2026-07-30T16:00:00Z'),
  0,
  'the scheduler does not replay a stale notification backlog'
);
SELECT is(
  (SELECT count(*)::integer
   FROM public.push_outbox o
   JOIN public.accounts a ON a.id=o.account_id
   WHERE o.kind='practice_incoming'
     AND a.user_id='1a000000-0000-0000-0000-000000000002'),
  0,
  'free accounts do not receive paid AI practice pushes'
);

SELECT * FROM finish();
ROLLBACK;
