BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,aud,role) VALUES
 ('34000000-0000-0000-0000-000000000001','spine-app@example.com',now(),'{}','{"first_name":"Ana","last_name":"Lee"}','authenticated','authenticated'),
 ('34000000-0000-0000-0000-000000000002','spine-web@example.com',now(),'{}','{}','authenticated','authenticated'),
 ('34000000-0000-0000-0000-000000000003','spine-other@example.com',now(),'{}','{}','authenticated','authenticated'),
 ('34000000-0000-0000-0000-000000000004','spine-coach@example.com',now(),'{}','{}','authenticated','authenticated');
UPDATE accounts SET id=('44000000-0000-0000-0000-'||right(user_id::text,12))::uuid
 WHERE user_id::text LIKE '34000000-0000-0000-0000-00000000000%';
SELECT ok(EXISTS(SELECT 1 FROM spine_outbox WHERE event_name='account_created' AND payload->>'email'='spine-app@example.com'
  AND payload ? 'occurred_at'), 'account_created carries occurred_at for idempotent hub retries');
DELETE FROM spine_outbox;

CREATE FUNCTION pg_temp.events(p_email text, p_event text) RETURNS integer LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.spine_outbox WHERE event_name=p_event AND payload->>'email'=p_email;
$$;

-- ── App Store (RevenueCat mirror) ───────────────────────────────────────────
SELECT public.reconcile_revenuecat_entitlements('44000000-0000-0000-0000-000000000001',
  jsonb_build_object('essential', now()+interval '30 days'));
SELECT is(pg_temp.events('spine-app@example.com','membership_started'), 1, 'an App Store subscription start is reported');
SELECT is((SELECT (payload->'props') - 'expires_at' FROM spine_outbox WHERE payload->>'email'='spine-app@example.com'),
  '{"tier":"essential","source":"app_store"}'::jsonb, 'with its tier and source');
SELECT is((SELECT row(payload->>'property', payload->>'name', payload ? 'occurred_at', payload ? 'payment')::text
  FROM spine_outbox WHERE payload->>'email'='spine-app@example.com'),
  row('soberhelpline','Ana Lee',true,false)::text, 'as the app property, with a stable time and no fabricated payment');
SELECT public.reconcile_revenuecat_entitlements('44000000-0000-0000-0000-000000000001',
  jsonb_build_object('essential', now()+interval '60 days'));
SELECT is(pg_temp.events('spine-app@example.com','membership_started'), 1, 'a renewal refreshes in place: no second event');
SELECT public.reconcile_revenuecat_entitlements('44000000-0000-0000-0000-000000000001',
  jsonb_build_object('premium', now()+interval '30 days'));
SELECT is((SELECT count(*)::int FROM spine_outbox WHERE payload->>'email'='spine-app@example.com'
  AND payload#>>'{props,tier}'='premier'), 1, 'an upgrade to Premier is reported as premier');
SELECT is(pg_temp.events('spine-app@example.com','payment'), 0, 'subscriptions never become $0 payments');

-- ── Website-granted ─────────────────────────────────────────────────────────
SELECT public.service_membership_import(jsonb_build_array(
  jsonb_build_object('email','spine-web@example.com','expires_at',now()+interval '30 days')), false, true);
SELECT is(pg_temp.events('spine-web@example.com','membership_started'), 1, 'a website grant is reported');
SELECT is((SELECT payload#>>'{props,source}' FROM spine_outbox WHERE payload->>'email'='spine-web@example.com'), 'website',
  'as a website membership');
SELECT public.reconcile_web_membership('44000000-0000-0000-0000-000000000002', '{"isMember":true}');
SELECT is(pg_temp.events('spine-web@example.com','membership_started'), 1,
  'the app''s own web mirror of the same membership is not a second event');
-- Off the list → expired; back on the list → the same row is re-granted.
DELETE FROM entitlements WHERE account_id='44000000-0000-0000-0000-000000000002' AND source='web';
SELECT public.service_membership_import('[]'::jsonb, false, true);
SELECT public.service_membership_import(jsonb_build_array(
  jsonb_build_object('email','spine-web@example.com','expires_at',now()+interval '30 days')), false, true);
SELECT is(pg_temp.events('spine-web@example.com','membership_started'), 2, 'a website re-grant after a revoke is reported');
SELECT public.service_membership_import(jsonb_build_array(
  jsonb_build_object('email','spine-web@example.com','expires_at',now()+interval '45 days')), false, true);
SELECT is(pg_temp.events('spine-web@example.com','membership_started'), 2, 'extending an active grant is not');

-- ── Not paid memberships ────────────────────────────────────────────────────
INSERT INTO entitlements(account_id,source,tier,expires_at,raw) VALUES
 ('44000000-0000-0000-0000-000000000003','scholarship','essential',NULL,NULL),
 ('44000000-0000-0000-0000-000000000003','org','org',NULL,NULL),
 ('44000000-0000-0000-0000-000000000003','revenuecat','essential',now()-interval '1 day',NULL);
SELECT is(pg_temp.events('spine-other@example.com','membership_started'), 0,
  'staff scholarships, org access and already-expired rows are not reported');

-- ── Coaching payments ───────────────────────────────────────────────────────
INSERT INTO coaching_bookings(id,account_id,preferred_times,rate_cents) VALUES
 ('54000000-0000-0000-0000-000000000001','44000000-0000-0000-0000-000000000004','any',15000),
 ('54000000-0000-0000-0000-000000000002','44000000-0000-0000-0000-000000000004','any',15000),
 ('54000000-0000-0000-0000-000000000003','44000000-0000-0000-0000-000000000004','any',15000);
SELECT ok((SELECT bool_and(payload ? 'occurred_at') FROM spine_outbox WHERE event_name='session_booked'
  AND payload->>'email'='spine-coach@example.com'), 'session_booked carries occurred_at');
INSERT INTO plan_review_payment_events(event_id,coaching_booking_id,paypal_order_id,paypal_capture_id,payment_status,
  amount_cents,currency,occurred_at,source) VALUES
 ('evt-spine-paypal-1','54000000-0000-0000-0000-000000000001','ORDER-SPINE-1','CAPTURE-SPINE-1','captured',12500,'USD',now()-interval '1 minute','paypal'),
 ('manual.spine00000002','54000000-0000-0000-0000-000000000002','MANUAL-SPINE-2','MANUAL-SPINE-2','captured',15000,'USD',now(),'manual');
UPDATE coaching_bookings SET payment_status='paid' WHERE account_id='44000000-0000-0000-0000-000000000004';
SELECT results_eq(
  $$SELECT payload#>>'{payment,id}', payload#>>'{payment,processor}', (payload#>>'{payment,amount_cents}')::int, payload#>>'{payment,kind}'
    FROM spine_outbox WHERE event_name='payment' AND payload->>'email'='spine-coach@example.com' ORDER BY 1$$,
  $$VALUES ('54000000-0000-0000-0000-000000000001_coaching','paypal',12500,'coaching_session'),
           ('54000000-0000-0000-0000-000000000002_coaching','manual',15000,'coaching_session'),
           ('54000000-0000-0000-0000-000000000003_coaching','manual',15000,'coaching_session')$$,
  'coaching payments carry the real processor and the captured amount (member price included)');
SELECT is((SELECT (payload->>'occurred_at')::timestamptz FROM spine_outbox WHERE event_name='payment'
  AND payload#>>'{payment,id}'='54000000-0000-0000-0000-000000000001_coaching'), now()-interval '1 minute',
  'the payment event is stamped with the capture time');
UPDATE coaching_bookings SET status='confirmed' WHERE account_id='44000000-0000-0000-0000-000000000004';
SELECT is(pg_temp.events('spine-coach@example.com','payment'), 3, 'later booking updates do not re-report the payment');

SELECT ok(NOT has_function_privilege('anon','public._spine_on_entitlement_change()','EXECUTE')
  AND NOT has_function_privilege('authenticated','public._spine_on_entitlement_change()','EXECUTE'),
  'the trigger function is not callable by clients');

SELECT * FROM finish();
ROLLBACK;
