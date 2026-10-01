BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(27);

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role) VALUES
 ('63000000-0000-0000-0000-000000000001','pr-owner@example.com','{}','{}','authenticated','authenticated'),
 ('63000000-0000-0000-0000-000000000002','pr-coach@example.com','{}','{}','authenticated','authenticated'),
 ('63000000-0000-0000-0000-000000000003','pr-essential-a@example.com','{}','{}','authenticated','authenticated'),
 ('63000000-0000-0000-0000-000000000004','pr-upgrader-b@example.com','{}','{}','authenticated','authenticated'),
 ('63000000-0000-0000-0000-000000000005','pr-manual-d@example.com','{}','{}','authenticated','authenticated');
UPDATE public.accounts SET id = ('64000000-0000-0000-0000-' || right(user_id::text, 12))::uuid, type = 'direct', timezone = 'America/Chicago'
WHERE user_id::text LIKE '63000000-0000-0000-0000-0000000000%';
INSERT INTO public.entitlements(account_id, source, tier, expires_at) VALUES
 ('64000000-0000-0000-0000-000000000003', 'scholarship', 'essential', now() + interval '30 days'),
 ('64000000-0000-0000-0000-000000000004', 'scholarship', 'essential', now() + interval '30 days'),
 ('64000000-0000-0000-0000-000000000005', 'scholarship', 'essential', now() + interval '30 days');
INSERT INTO public.video_staff_roles(account_id, role) VALUES
 ('64000000-0000-0000-0000-000000000001', 'owner'),
 ('64000000-0000-0000-0000-000000000002', 'coach');

-- Member A: one ordinary coaching request plus a one-off plan review.
INSERT INTO public.coaching_bookings(account_id, preferred_times, note)
VALUES ('64000000-0000-0000-0000-000000000003', 'Tue, Oct 6 · Morning', 'regular call');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"63000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SELECT request_plan_review_video_session(now()+interval '4 days','America/Chicago',60,'plan_review',NULL,'[]','{safetyPlan}'::text[],'{"schemaVersion":"1","sections":{"safetyPlan":{}}}'::jsonb,'I choose to share this plan. This is not an emergency service.','en','one_off_150');
SELECT set_config('request.jwt.claims','{"sub":"63000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
SELECT request_plan_review_video_session(now()+interval '4 days 2 hours','America/Chicago',60,'plan_review',NULL,'[]','{safetyPlan}'::text[],'{"schemaVersion":"1","sections":{"safetyPlan":{}}}'::jsonb,'I choose to share this plan. This is not an emergency service.','en','one_off_150');
SELECT set_config('request.jwt.claims','{"sub":"63000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
SELECT request_plan_review_video_session(now()+interval '4 days 4 hours','America/Chicago',60,'plan_review',NULL,'[]','{safetyPlan}'::text[],'{"schemaVersion":"1","sections":{"safetyPlan":{}}}'::jsonb,'I choose to share this plan. This is not an emergency service.','en','one_off_150');

-- ── C1: My bookings excludes plan-review payment records ───────────────────
SELECT set_config('request.jwt.claims','{"sub":"63000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SELECT is((SELECT count(*)::integer FROM member_get_coaching_bookings(10)), 1, 'My bookings lists only the ordinary coaching request');
SELECT is((SELECT preferred_times FROM member_get_coaching_bookings(10)), 'Tue, Oct 6 · Morning', 'the ordinary request is returned unchanged');
SELECT set_config('request.jwt.claims','{"sub":"63000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
SELECT is((SELECT count(*)::integer FROM member_get_coaching_bookings(10)), 0, 'another member sees none of these bookings');
RESET ROLE;
SELECT ok(NOT has_function_privilege('anon', 'public.member_get_coaching_bookings(integer)', 'EXECUTE'), 'bookings RPC is not anonymous');
SELECT matches((SELECT preferred_times FROM coaching_bookings WHERE account_id = '64000000-0000-0000-0000-000000000003' AND note = 'Plan review video session'),
  '^\d{4}-\d{2}-\d{2} \d{2}:\d{2} \(America/Chicago\)$', 'the plan-review payment record shows the time in the member''s zone');

-- ── C2: Premier upgrade converts a pending one-off ─────────────────────────
SELECT ok(NOT has_function_privilege('authenticated', 'public.service_convert_plan_review_to_included(uuid)', 'EXECUTE'), 'members cannot convert their own booking');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(service_convert_plan_review_to_included((SELECT id FROM video_sessions WHERE account_id = '64000000-0000-0000-0000-000000000004')), 'not_eligible',
  'an Essential member keeps the one-off');
RESET ROLE;
INSERT INTO public.entitlements(account_id, source, tier, expires_at)
VALUES ('64000000-0000-0000-0000-000000000004', 'scholarship', 'premium', now() + interval '30 days');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(service_convert_plan_review_to_included((SELECT id FROM video_sessions WHERE account_id = '64000000-0000-0000-0000-000000000004')), 'converted',
  'an upgraded member''s pending one-off is converted');
RESET ROLE;
SELECT ok((SELECT appointment_type = 'membership_included' AND payment_status = 'included' AND member_tier_at_booking = 'premier'
           FROM video_sessions WHERE account_id = '64000000-0000-0000-0000-000000000004'), 'the review is now included with Premier');
SELECT is((SELECT b.status FROM coaching_bookings b JOIN video_sessions s ON s.coaching_booking_id = b.id
           WHERE s.account_id = '64000000-0000-0000-0000-000000000004'), 'cancelled', 'the unpaid $150 record is cancelled');
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT is(service_convert_plan_review_to_included((SELECT id FROM video_sessions WHERE account_id = '64000000-0000-0000-0000-000000000004')), 'not_eligible',
  'conversion is idempotent');
-- A checkout opened before the upgrade can still complete.
SELECT is((apply_plan_review_payment_event('capture.converted.001', (SELECT id FROM video_sessions WHERE account_id = '64000000-0000-0000-0000-000000000004'),
  'ORDER-CONV-1', 'CAPTURE-CONV-1', 'captured', 15000, 'USD', now())->>'refund_owed')::boolean, true,
  'a late capture for a converted review is recorded as a refund owed');
RESET ROLE;
SELECT is((SELECT payment_status FROM video_sessions WHERE account_id = '64000000-0000-0000-0000-000000000004'), 'included', 'the converted session stays included');
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE kind = 'admin_refund_owed' AND account_id = '64000000-0000-0000-0000-000000000001'
           AND metadata->>'session_id' = (SELECT id::text FROM video_sessions WHERE account_id = '64000000-0000-0000-0000-000000000004')), 1,
  'the owner is told to refund it');

-- ── C3: owner-only manual payment ──────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"63000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SELECT throws_ok($$SELECT admin_mark_plan_review_paid((SELECT id FROM video_sessions WHERE account_id = '64000000-0000-0000-0000-000000000005'), 'Paid by check')$$,
  '42501', 'not_authorized', 'a coach cannot record a manual payment');
SELECT set_config('request.jwt.claims','{"sub":"63000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
SELECT throws_ok($$SELECT admin_mark_plan_review_paid((SELECT id FROM video_sessions WHERE account_id = '64000000-0000-0000-0000-000000000005'), 'Paid by check')$$,
  '42501', 'not_authorized', 'a member cannot mark her own review paid');
SELECT set_config('request.jwt.claims','{"sub":"63000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SELECT throws_ok($$SELECT admin_mark_plan_review_paid((SELECT id FROM video_sessions WHERE account_id = '64000000-0000-0000-0000-000000000005'), '  ')$$,
  'P0001', 'manual_payment_note_required', 'a manual payment needs a note');
SELECT throws_ok($$SELECT admin_mark_plan_review_paid((SELECT id FROM video_sessions WHERE account_id = '64000000-0000-0000-0000-000000000004'), 'Paid by check')$$,
  'P0001', 'not_one_off_plan_review', 'an included review cannot be marked paid');
SELECT lives_ok($$SELECT admin_mark_plan_review_paid((SELECT id FROM video_sessions WHERE account_id = '64000000-0000-0000-0000-000000000005'), 'Paid by Zelle 9/30')$$,
  'the owner can mark a pending one-off paid');
SELECT throws_ok($$SELECT admin_mark_plan_review_paid((SELECT id FROM video_sessions WHERE account_id = '64000000-0000-0000-0000-000000000005'), 'Paid twice')$$,
  'P0001', 'already_paid', 'a paid review cannot be marked paid again');
RESET ROLE;
SELECT is((SELECT payment_status FROM video_sessions WHERE account_id = '64000000-0000-0000-0000-000000000005'), 'paid', 'the session is paid');
SELECT is((SELECT b.payment_status FROM coaching_bookings b JOIN video_sessions s ON s.coaching_booking_id = b.id
           WHERE s.account_id = '64000000-0000-0000-0000-000000000005'), 'paid', 'the coaching payment record is paid');
SELECT ok((SELECT source = 'manual' AND payment_status = 'captured' AND note = 'Paid by Zelle 9/30' AND recorded_by_account_id = '64000000-0000-0000-0000-000000000001'
           FROM plan_review_payment_events WHERE session_id = (SELECT id FROM video_sessions WHERE account_id = '64000000-0000-0000-0000-000000000005')),
  'a manual payment event records who and why');
SELECT is((SELECT count(*)::integer FROM video_session_events e JOIN video_sessions s ON s.id = e.session_id
           WHERE s.account_id = '64000000-0000-0000-0000-000000000005' AND e.event_type = 'payment_marked_paid_manually'), 1, 'the audit trail records the manual payment');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"63000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SELECT lives_ok($$SELECT coach_confirm_video_session((SELECT id FROM video_sessions WHERE account_id = '64000000-0000-0000-0000-000000000005'),
  (SELECT version FROM video_sessions WHERE account_id = '64000000-0000-0000-0000-000000000005'), NULL)$$,
  'the payment guard accepts a manually paid review');
SELECT set_config('request.jwt.claims','{"sub":"63000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SELECT is((SELECT count(*)::integer FROM member_get_coaching_bookings(10)), 1, 'a paid plan-review record still stays out of My bookings');
RESET ROLE;
SELECT ok(NOT has_function_privilege('anon', 'public.admin_mark_plan_review_paid(uuid,text)', 'EXECUTE'), 'manual payment is not anonymous');

SELECT * FROM finish();
ROLLBACK;
