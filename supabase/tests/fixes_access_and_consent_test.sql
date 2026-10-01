BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(16);

-- ── E2: provider accounts are paid only while their organization is active ──
INSERT INTO public.orgs(id, name, status) VALUES
 ('67000000-0000-0000-0000-0000000000a1', 'Active Provider', 'active'),
 ('67000000-0000-0000-0000-0000000000a2', 'Suspended Provider', 'suspended');
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role) VALUES
 ('67000000-0000-0000-0000-000000000001','org-active@example.com','{}','{}','authenticated','authenticated'),
 ('67000000-0000-0000-0000-000000000002','org-suspended@example.com','{}','{}','authenticated','authenticated');
UPDATE public.accounts SET id = ('68000000-0000-0000-0000-' || right(user_id::text, 12))::uuid, timezone = 'UTC', locale = 'en'
WHERE user_id::text LIKE '67000000-0000-0000-0000-0000000000%';
UPDATE public.accounts SET type = 'attached', org_id = '67000000-0000-0000-0000-0000000000a1',
  push_token = 'ExponentPushToken[org-active]' WHERE id = '68000000-0000-0000-0000-000000000001';
UPDATE public.accounts SET type = 'attached', org_id = '67000000-0000-0000-0000-0000000000a2',
  push_token = 'ExponentPushToken[org-suspended]' WHERE id = '68000000-0000-0000-0000-000000000002';
INSERT INTO public.practice_push_preferences(account_id, enabled, frequency_per_week, window_start_hour, window_end_hour)
VALUES ('68000000-0000-0000-0000-000000000001', true, 2, 10, 20),
       ('68000000-0000-0000-0000-000000000002', true, 2, 10, 20);
UPDATE public.practice_push_preferences SET next_prompt_at = '2027-01-05T15:00:00Z'
WHERE account_id IN ('68000000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000002');

SELECT ok(enqueue_due_practice_pushes('2027-01-05T16:00:00Z') >= 1, 'the scheduler runs');
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE account_id = '68000000-0000-0000-0000-000000000001' AND kind = 'practice_incoming'), 1,
  'an active provider''s member gets her practice call');
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE account_id = '68000000-0000-0000-0000-000000000002' AND kind = 'practice_incoming'), 0,
  'a suspended provider''s member is not treated as paid');

INSERT INTO public.practice_push_events(event_id, account_id, expires_at) VALUES
 ('67000000-0000-4000-8000-0000000000e1', '68000000-0000-0000-0000-000000000001', now() + interval '1 hour'),
 ('67000000-0000-4000-8000-0000000000e2', '68000000-0000-0000-0000-000000000002', now() + interval '1 hour');
SELECT ok(practice_push_delivery_ttl('67000000-0000-4000-8000-0000000000e1', '68000000-0000-0000-0000-000000000001') > 0,
  'delivery proceeds for an active provider');
SELECT is(practice_push_delivery_ttl('67000000-0000-4000-8000-0000000000e2', '68000000-0000-0000-0000-000000000002'), NULL,
  'delivery is withheld for a suspended provider');

INSERT INTO public.entitlements(account_id, source, tier, expires_at)
VALUES ('68000000-0000-0000-0000-000000000002', 'scholarship', 'premium', now() + interval '30 days');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"67000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SELECT is((request_plan_review_video_session(now()+interval '3 days','UTC',60,'plan_review',NULL,'[]','{safetyPlan}'::text[],'{"schemaVersion":"1","sections":{"safetyPlan":{}}}'::jsonb,'I choose to share this plan. This is not an emergency service.','en','membership_included')).member_tier_at_booking,
  'premier', 'a suspended provider''s member with her own Premier books as Premier, not organization');
SELECT set_config('request.jwt.claims','{"sub":"67000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SELECT is((request_plan_review_video_session(now()+interval '3 days 2 hours','UTC',60,'plan_review',NULL,'[]','{safetyPlan}'::text[],'{"schemaVersion":"1","sections":{"safetyPlan":{}}}'::jsonb,'I choose to share this plan. This is not an emergency service.','en','membership_included')).member_tier_at_booking,
  'organization', 'an active provider''s member books as organization');
RESET ROLE;

-- ── F2: admin Urgent Text Line push carries its routing kind ───────────────
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role) VALUES
 ('67000000-0000-0000-0000-000000000003','matt@soberhelpline.com','{}','{}','authenticated','authenticated'),
 ('67000000-0000-0000-0000-000000000004','textline-member@example.com','{}','{}','authenticated','authenticated');
UPDATE public.accounts SET push_token = 'ExponentPushToken[admin]' WHERE user_id = '67000000-0000-0000-0000-000000000003';
INSERT INTO public.threads(id, account_id, kind)
SELECT '67000000-0000-4000-8000-0000000000f1', id, 'oncall' FROM public.accounts WHERE user_id = '67000000-0000-0000-0000-000000000004';
INSERT INTO public.messages(thread_id, sender_role, body) VALUES ('67000000-0000-4000-8000-0000000000f1', 'member', 'I need help tonight');
SELECT is((SELECT metadata->>'kind' FROM push_outbox WHERE kind = 'admin_textline_message'
           AND account_id = (SELECT id FROM accounts WHERE user_id = '67000000-0000-0000-0000-000000000003')),
  'admin_textline_message', 'the admin text-line push carries its kind for routing');
SELECT is((SELECT metadata->>'thread_id' FROM push_outbox WHERE kind = 'admin_textline_message'
           AND account_id = (SELECT id FROM accounts WHERE user_id = '67000000-0000-0000-0000-000000000003')),
  '67000000-0000-4000-8000-0000000000f1', 'and the thread it is about');

-- ── F3: consent is recorded even when the device clock runs ahead ───────────
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role) VALUES
 ('67000000-0000-0000-0000-000000000005','clock-ahead@example.com','{}',
   jsonb_build_object('terms_version','1.0','terms_accepted_at', to_char((now() + interval '3 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),'authenticated','authenticated'),
 ('67000000-0000-0000-0000-000000000006','clock-garbled@example.com','{}',
   jsonb_build_object('terms_version','1.1','terms_accepted_at','not a time'),'authenticated','authenticated'),
 ('67000000-0000-0000-0000-000000000007','clock-behind@example.com','{}',
   jsonb_build_object('terms_version','1.0','terms_accepted_at','2001-01-01T00:00:00Z'),'authenticated','authenticated'),
 ('67000000-0000-0000-0000-000000000008','no-version@example.com','{}',
   jsonb_build_object('terms_accepted_at','2026-07-13T00:00:00Z'),'authenticated','authenticated');
UPDATE auth.users SET created_at = now() WHERE id::text LIKE '67000000-0000-0000-0000-00000000000%';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"67000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
SELECT is(record_signup_terms_consent(), true, 'a device clock hours ahead still records consent');
SELECT set_config('request.jwt.claims','{"sub":"67000000-0000-0000-0000-000000000006","role":"authenticated"}',true);
SELECT is(record_signup_terms_consent(), true, 'an unreadable device time still records the accepted version');
SELECT set_config('request.jwt.claims','{"sub":"67000000-0000-0000-0000-000000000007","role":"authenticated"}',true);
SELECT is(record_signup_terms_consent(), true, 'a device clock far behind still records consent');
SELECT set_config('request.jwt.claims','{"sub":"67000000-0000-0000-0000-000000000008","role":"authenticated"}',true);
SELECT is(record_signup_terms_consent(), false, 'without an accepted version nothing is recorded');
RESET ROLE;
SELECT ok((SELECT granted_at <= now() AND version = '1.0' FROM consents c JOIN accounts a ON a.id = c.account_id
           WHERE a.user_id = '67000000-0000-0000-0000-000000000005' AND c.consent_key = '1'), 'a future device time is clamped to the server clock');
SELECT ok((SELECT granted_at = now() AND version = '1.1' FROM consents c JOIN accounts a ON a.id = c.account_id
           WHERE a.user_id = '67000000-0000-0000-0000-000000000006' AND c.consent_key = '1'), 'an unreadable time uses the server clock');
SELECT ok((SELECT c.granted_at >= u.created_at - interval '1 day' FROM consents c JOIN accounts a ON a.id = c.account_id JOIN auth.users u ON u.id = a.user_id
           WHERE a.user_id = '67000000-0000-0000-0000-000000000007' AND c.consent_key = '1'), 'a past device time is not earlier than the signup');

SELECT * FROM finish();
ROLLBACK;
