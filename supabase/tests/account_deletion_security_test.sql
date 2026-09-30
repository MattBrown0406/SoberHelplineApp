BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(8);

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

-- A member with a private video request (their own proposal row), a linked
-- coaching booking and a captured plan-review payment can still delete.
INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role)
VALUES ('12000000-0000-0000-0000-000000000002','delete-video@example.com','{}','{}','authenticated','authenticated');
UPDATE public.accounts SET type='direct', timezone='America/Los_Angeles'
WHERE user_id='12000000-0000-0000-0000-000000000002';
INSERT INTO public.entitlements(account_id,source,tier,expires_at)
SELECT id,'scholarship','premium',now()+interval '30 days' FROM public.accounts
WHERE user_id='12000000-0000-0000-0000-000000000002';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"12000000-0000-0000-0000-000000000002","email":"delete-video@example.com","role":"authenticated"}',true);
SELECT lives_ok(
  $$SELECT request_private_video_session(now()+interval '3 days','America/Los_Angeles',60,'deletion fixture')$$,
  'fixture member requests a private video session'
);
RESET ROLE;

WITH member AS (
  SELECT id FROM public.accounts WHERE user_id='12000000-0000-0000-0000-000000000002'
), booking AS (
  INSERT INTO public.coaching_bookings(account_id, preferred_times, payment_status)
  SELECT id, 'any', 'paid' FROM member
  RETURNING id
), linked AS (
  UPDATE public.video_sessions s SET coaching_booking_id = booking.id
  FROM booking, member WHERE s.account_id = member.id
  RETURNING s.id AS session_id, booking.id AS booking_id
)
INSERT INTO public.plan_review_payment_events
  (event_id, session_id, coaching_booking_id, paypal_order_id, paypal_capture_id, payment_status, amount_cents, currency)
SELECT 'evt-deletion-fixture', session_id, booking_id, 'order-fixture', 'capture-fixture', 'captured', 15000, 'USD'
FROM linked;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"12000000-0000-0000-0000-000000000002","email":"delete-video@example.com","role":"authenticated"}',true);
SELECT lives_ok(
  $$SELECT public.delete_own_account()$$,
  'a member with video and plan-review history can delete their account'
);
RESET ROLE;
SET CONSTRAINTS ALL IMMEDIATE;

SELECT is(
  (SELECT count(*)::integer FROM public.video_session_proposals p
   WHERE NOT EXISTS (SELECT 1 FROM public.accounts a WHERE a.id = p.proposed_by_account_id)),
  0,
  'deleted member leaves no orphaned video proposals'
);
SELECT is(
  (SELECT session_id FROM public.plan_review_payment_events WHERE event_id='evt-deletion-fixture'),
  NULL::uuid,
  'the payment record is kept with its session link cleared'
);

SELECT * FROM finish();
ROLLBACK;
