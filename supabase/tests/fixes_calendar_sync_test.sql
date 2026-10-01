BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(25);

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role) VALUES
 ('61000000-0000-0000-0000-000000000001','cal-owner@example.com','{}','{}','authenticated','authenticated'),
 ('61000000-0000-0000-0000-000000000002','cal-coach@example.com','{}','{}','authenticated','authenticated'),
 ('61000000-0000-0000-0000-000000000003','cal-member-a@example.com','{}','{}','authenticated','authenticated'),
 ('61000000-0000-0000-0000-000000000004','cal-member-b@example.com','{}','{}','authenticated','authenticated'),
 ('61000000-0000-0000-0000-000000000005','cal-member-c@example.com','{}','{}','authenticated','authenticated'),
 ('61000000-0000-0000-0000-000000000006','cal-member-d@example.com','{}','{}','authenticated','authenticated'),
 ('61000000-0000-0000-0000-000000000007','cal-member-e@example.com','{}','{}','authenticated','authenticated');
UPDATE public.accounts SET id = ('62000000-0000-0000-0000-' || right(user_id::text, 12))::uuid, type = 'direct', timezone = 'America/Chicago'
WHERE user_id::text LIKE '61000000-0000-0000-0000-0000000000%';
INSERT INTO public.entitlements(account_id, source, tier, expires_at)
SELECT id, 'scholarship', 'premium', now() + interval '30 days' FROM public.accounts
WHERE user_id BETWEEN '61000000-0000-0000-0000-000000000003'::uuid AND '61000000-0000-0000-0000-000000000007'::uuid;
INSERT INTO public.video_staff_roles(account_id, role) VALUES
 ('62000000-0000-0000-0000-000000000001', 'owner'),
 ('62000000-0000-0000-0000-000000000002', 'coach');
-- Rolled back with the test: lets the dispatcher run its lease query (pg_net
-- only sends queued requests after commit).
SELECT vault.create_secret('fixture-service-key', 'SUPABASE_SERVICE_ROLE_KEY');

CREATE TEMP TABLE fx(member text PRIMARY KEY, account uuid);
INSERT INTO fx VALUES
 ('a','62000000-0000-0000-0000-000000000003'),('b','62000000-0000-0000-0000-000000000004'),
 ('c','62000000-0000-0000-0000-000000000005'),('d','62000000-0000-0000-0000-000000000006'),
 ('e','62000000-0000-0000-0000-000000000007');
GRANT SELECT ON fx TO authenticated;

-- Each member requests a distinct slot; the coach confirms them all.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
SELECT request_private_video_session(now()+interval '3 days','America/Chicago',60,NULL);
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
SELECT request_private_video_session(now()+interval '3 days 2 hours','America/Chicago',60,NULL);
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
SELECT request_private_video_session(now()+interval '3 days 4 hours','America/Chicago',60,NULL);
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000006","role":"authenticated"}',true);
SELECT request_private_video_session(now()+interval '3 days 6 hours','America/Chicago',60,NULL);
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000007","role":"authenticated"}',true);
SELECT request_private_video_session(now()+interval '3 days 8 hours','America/Chicago',60,NULL);
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SELECT coach_confirm_video_session(s.id, s.version, NULL) FROM video_sessions s JOIN fx ON fx.account = s.account_id;
RESET ROLE;

-- Isolate the dispatcher from any other local rows.
UPDATE video_sessions SET calendar_sync_status = 'not_synced'
WHERE account_id NOT IN (SELECT account FROM fx) AND calendar_sync_status IN ('pending','failed','processing');

SELECT is((SELECT calendar_sync_status FROM video_sessions WHERE account_id = (SELECT account FROM fx WHERE member='a')), 'pending', 'confirmation queues calendar work');
SELECT is((SELECT calendar_sync_attempts FROM video_sessions WHERE account_id = (SELECT account FROM fx WHERE member='a')), 0, 'new calendar work starts with no attempts');

-- Member C stays pending (never dispatched) and is cancelled first.
UPDATE video_sessions SET calendar_next_attempt_at = now() + interval '1 hour' WHERE account_id = (SELECT account FROM fx WHERE member='c');

SELECT is(dispatch_pending_video_calendar_sync(), 4, 'dispatcher leases every due row');
SELECT is((SELECT calendar_sync_status FROM video_sessions WHERE account_id = (SELECT account FROM fx WHERE member='a')), 'processing', 'dispatched row is leased');
SELECT is((SELECT calendar_sync_attempts FROM video_sessions WHERE account_id = (SELECT account FROM fx WHERE member='a')), 1, 'dispatch counts an attempt');
SELECT is((SELECT calendar_event_id FROM video_sessions WHERE account_id = (SELECT account FROM fx WHERE member='a')),
  (SELECT 'vsession' || replace(id::text, '-', '') FROM video_sessions WHERE account_id = (SELECT account FROM fx WHERE member='a')),
  'a scheduled session records the deterministic event id the function creates');
SELECT is((SELECT calendar_sync_status FROM video_sessions WHERE account_id = (SELECT account FROM fx WHERE member='c')), 'pending', 'a row waiting for its next attempt is not dispatched early');

-- The function reports a failure with backoff (as calendarFailureUpdate does).
UPDATE video_sessions SET calendar_sync_status = 'failed', calendar_sync_error = 'google_calendar_failed: x',
  calendar_next_attempt_at = now() + interval '5 minutes', calendar_lease_token = NULL, calendar_lease_version = NULL, calendar_lease_expires_at = NULL
WHERE account_id = (SELECT account FROM fx WHERE member='a');
SELECT is(dispatch_pending_video_calendar_sync(), 0, 'a failed row is not retried before its backoff elapses');
UPDATE video_sessions SET calendar_next_attempt_at = now() - interval '1 second' WHERE account_id = (SELECT account FROM fx WHERE member='a');
SELECT is(dispatch_pending_video_calendar_sync(), 1, 'a failed row is retried once its backoff elapses');
SELECT is((SELECT calendar_sync_attempts FROM video_sessions WHERE account_id = (SELECT account FROM fx WHERE member='a')), 2, 'the retry counts a second attempt');

-- Cancelling while the create is in flight still queues deletion of the event.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SELECT coach_cancel_video_session((SELECT id FROM video_sessions WHERE account_id = (SELECT account FROM fx WHERE member='a')),
  (SELECT version FROM video_sessions WHERE account_id = (SELECT account FROM fx WHERE member='a')), 'fixture');
RESET ROLE;
SELECT is((SELECT calendar_sync_status FROM video_sessions WHERE account_id = (SELECT account FROM fx WHERE member='a')), 'pending', 'cancel during an in-flight create queues the delete');
SELECT is((SELECT calendar_sync_attempts FROM video_sessions WHERE account_id = (SELECT account FROM fx WHERE member='a')), 0, 'the delete starts a fresh retry budget');

-- Legacy row: failed with no stored id (leased before ids were recorded).
UPDATE video_sessions SET calendar_sync_status = 'failed', calendar_event_id = NULL, calendar_lease_token = NULL,
  calendar_lease_version = NULL, calendar_lease_expires_at = NULL
WHERE account_id = (SELECT account FROM fx WHERE member='b');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000004","role":"authenticated"}',true);
SELECT member_cancel_video_session((SELECT id FROM video_sessions WHERE account_id = (SELECT account FROM fx WHERE member='b')),
  (SELECT version FROM video_sessions WHERE account_id = (SELECT account FROM fx WHERE member='b')), NULL);
RESET ROLE;
SELECT is((SELECT calendar_sync_status FROM video_sessions WHERE account_id = (SELECT account FROM fx WHERE member='b')), 'pending',
  'a cancel with calendar_event_id NULL after a failed sync deletes by deterministic id instead of skipping');

-- Never dispatched: nothing can be on the calendar, so nothing is queued.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000005","role":"authenticated"}',true);
SELECT member_cancel_video_session((SELECT id FROM video_sessions WHERE account_id = (SELECT account FROM fx WHERE member='c')),
  (SELECT version FROM video_sessions WHERE account_id = (SELECT account FROM fx WHERE member='c')), NULL);
RESET ROLE;
SELECT is((SELECT calendar_sync_status FROM video_sessions WHERE account_id = (SELECT account FROM fx WHERE member='c')), 'cancelled', 'a never-dispatched cancel needs no calendar work');

-- Attempt limit: exhausted failures stop; an unreported last attempt fails.
UPDATE video_sessions SET calendar_sync_status = 'failed', calendar_sync_attempts = 6, calendar_next_attempt_at = NULL,
  calendar_lease_token = NULL, calendar_lease_version = NULL, calendar_lease_expires_at = NULL
WHERE account_id = (SELECT account FROM fx WHERE member='d');
UPDATE video_sessions SET calendar_sync_status = 'processing', calendar_sync_attempts = 6, calendar_sync_error = NULL,
  calendar_lease_token = gen_random_uuid(), calendar_lease_version = version, calendar_lease_expires_at = now() - interval '1 minute'
WHERE account_id = (SELECT account FROM fx WHERE member='e');
UPDATE video_sessions SET calendar_sync_status = 'synced', calendar_lease_token = NULL WHERE account_id IN (SELECT account FROM fx WHERE member IN ('a','b'));
SELECT is(dispatch_pending_video_calendar_sync(), 0, 'exhausted rows are not dispatched again');
SELECT is((SELECT calendar_sync_status FROM video_sessions WHERE account_id = (SELECT account FROM fx WHERE member='e')), 'failed', 'an unreported final attempt is surfaced as failed');
SELECT alike((SELECT calendar_sync_error FROM video_sessions WHERE account_id = (SELECT account FROM fx WHERE member='e')), 'lease_expired:%', 'the failure explains the missing report');

-- Retry sync (staff only).
SELECT ok(has_function_privilege('authenticated', 'public.admin_retry_video_calendar_sync(uuid)', 'EXECUTE'), 'retry RPC is callable by signed-in users (checked inside)');
SELECT ok(NOT has_function_privilege('anon', 'public.admin_retry_video_calendar_sync(uuid)', 'EXECUTE'), 'retry RPC is not callable anonymously');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000006","role":"authenticated"}',true);
SELECT throws_ok($$SELECT admin_retry_video_calendar_sync((SELECT id FROM fx JOIN video_sessions s ON s.account_id = fx.account WHERE member='d'))$$,
  '42501', 'not_authorized', 'a member cannot retry calendar sync');
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
SELECT lives_ok($$SELECT admin_retry_video_calendar_sync((SELECT s.id FROM fx JOIN video_sessions s ON s.account_id = fx.account WHERE member='d'))$$,
  'a coach can retry an exhausted sync');
RESET ROLE;
SELECT ok((SELECT calendar_sync_status = 'pending' AND calendar_sync_attempts = 0 AND calendar_sync_error IS NULL
           FROM video_sessions WHERE account_id = (SELECT account FROM fx WHERE member='d')), 'retry queues fresh calendar work');
UPDATE video_sessions SET calendar_sync_status = 'processing', calendar_lease_token = gen_random_uuid(),
  calendar_lease_version = version, calendar_lease_expires_at = now() + interval '5 minutes'
WHERE account_id = (SELECT account FROM fx WHERE member='d');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"61000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SELECT throws_ok($$SELECT admin_retry_video_calendar_sync((SELECT s.id FROM fx JOIN video_sessions s ON s.account_id = fx.account WHERE member='d'))$$,
  'P0001', 'calendar_sync_in_progress', 'a sync in flight cannot be re-queued');
SELECT throws_ok($$SELECT admin_retry_video_calendar_sync((SELECT s.id FROM fx JOIN video_sessions s ON s.account_id = fx.account WHERE member='c'))$$,
  'P0001', 'nothing_to_sync', 'a request that never reached the calendar has nothing to retry');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM video_session_events e JOIN video_sessions s ON s.id = e.session_id
           WHERE s.account_id = (SELECT account FROM fx WHERE member='d') AND e.event_type = 'calendar_sync_retry_requested'), 1,
  'the retry is recorded in the session audit trail');

SELECT * FROM finish();
ROLLBACK;
