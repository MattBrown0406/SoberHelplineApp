BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;
SELECT plan(21);

-- ── Accounts: A (bereaved), B (not bereaved), the admin ───────────────────
INSERT INTO auth.users(id, email, raw_app_meta_data, raw_user_meta_data, aud, role, email_confirmed_at) VALUES
  ('18000000-0000-0000-0000-000000000001', 'bq-a@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('18000000-0000-0000-0000-000000000002', 'bq-b@example.com', '{}', '{}', 'authenticated', 'authenticated', now()),
  ('18000000-0000-0000-0000-0000000000ff', 'matt@soberhelpline.com', '{}', '{}', 'authenticated', 'authenticated', now())
ON CONFLICT (id) DO NOTHING;
UPDATE public.accounts SET id = ('28000000-0000-0000-0000-00000000000' || right(user_id::text, 1))::uuid
WHERE user_id::text LIKE '18000000-0000-0000-0000-00000000000_';
UPDATE public.accounts SET push_token = 'ExponentPushToken[bq-' || right(id::text, 1) || ']', family_call_reminders = true,
  daily_push_opt_in = true, locale = 'en', created_at = now() - interval '30 days', last_winback_at = NULL
WHERE id::text LIKE '28000000-0000-0000-0000-00000000000_';
UPDATE public.accounts SET push_token = 'ExponentPushToken[bq-admin]' WHERE user_id = '18000000-0000-0000-0000-0000000000ff';
INSERT INTO public.loved_ones(account_id, died_at) VALUES ('28000000-0000-0000-0000-000000000001', now());

CREATE FUNCTION pg_temp.tz_at(local_hour integer) RETURNS text LANGUAGE sql AS $$
 SELECT CASE WHEN x=0 THEN 'Etc/GMT' WHEN x>0 THEN 'Etc/GMT+'||x ELSE 'Etc/GMT'||x END
 FROM (SELECT (((extract(hour FROM now() AT TIME ZONE 'UTC')::integer-local_hour+12)%24+24)%24)-12 AS x) s
$$;
-- The Monday call checks use fixed Monday-evening clocks (New York daytime).
CREATE FUNCTION pg_temp.call(k text, at_time timestamptz) RETURNS jsonb LANGUAGE sql AS $$
 SELECT dispatcher_job_delivery(k, '28000000-0000-0000-0000-000000000001', family_squares_session_id(), '2026-10-06T02:00:00Z', at_time)
$$;
CREATE FUNCTION pg_temp.winback() RETURNS jsonb LANGUAGE sql AS $$
 SELECT dispatcher_job_delivery('winback', '28000000-0000-0000-0000-000000000001', NULL, now() + interval '1 hour')
$$;
CREATE FUNCTION pg_temp.enqueue(k text, a uuid, m jsonb DEFAULT '{}') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE rid uuid;
BEGIN
 INSERT INTO push_outbox(account_id, kind, title, body, metadata, processing_at, processing_token)
 VALUES (a, k, 'Synthetic', 'Synthetic', m, now(), 'bb600000-0000-0000-0000-000000000001') RETURNING id INTO rid;
 RETURN rid;
END $$;
CREATE FUNCTION pg_temp.delivery(rid uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT dispatcher_outbox_delivery(rid, 'bb600000-0000-0000-0000-000000000001')
$$;

SELECT ok(NOT has_function_privilege('anon', 'public.set_bereavement_quiet(boolean)', 'execute'), 'anon cannot pause anything');
SELECT ok(NOT has_function_privilege('authenticated', 'public._account_reminders_paused(uuid)', 'execute'), 'clients cannot read the helper');

-- ── Positive controls while bereaved but not quiet: reminders keep going ──
UPDATE public.accounts SET timezone = 'America/New_York' WHERE id = '28000000-0000-0000-0000-000000000001';
SELECT ok(pg_temp.call('family_call_30min', '2026-10-06T01:30:00Z') IS NOT NULL, 'bereaved, not quiet: the 30-minute invite still goes');
INSERT INTO public.session_rsvps(account_id, session_id, status) VALUES ('28000000-0000-0000-0000-000000000001', family_squares_session_id(), 'going');
SELECT ok(pg_temp.call('session_reminder', '2026-10-06T01:05:00Z') IS NOT NULL, 'bereaved, not quiet: the hour-before reminder still goes');
UPDATE public.accounts SET timezone = pg_temp.tz_at(14) WHERE id = '28000000-0000-0000-0000-000000000001';
SELECT ok(pg_temp.winback() IS NOT NULL, 'bereaved, not quiet: winback still goes');
CREATE TEMP TABLE work(kind text PRIMARY KEY, id uuid);
INSERT INTO work VALUES ('followup', pg_temp.enqueue('family_call_followup', '28000000-0000-0000-0000-000000000001', '{"kind":"family_call_followup"}'));
SELECT ok(pg_temp.delivery(id) IS NOT NULL, 'bereaved, not quiet: the Tuesday note still goes') FROM work WHERE kind = 'followup';

-- ── She pauses: own account only ──────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"18000000-0000-0000-0000-000000000002","email":"bq-b@example.com","role":"authenticated"}', true);
SELECT throws_ok($$SELECT public.set_bereavement_quiet(true)$$, '22023', 'not_bereaved', 'only a bereaved member can pause');
SELECT set_config('request.jwt.claims', '{"sub":"18000000-0000-0000-0000-000000000001","email":"bq-a@example.com","role":"authenticated"}', true);
SELECT is(public.set_bereavement_quiet(true), true, 'A pauses reminders');
RESET ROLE;
SELECT ok(public._account_reminders_paused('28000000-0000-0000-0000-000000000001') AND NOT public._account_reminders_paused('28000000-0000-0000-0000-000000000002'),
  'the pause is A''s alone');

-- ── Every engagement push waits ───────────────────────────────────────────
SELECT is(pg_temp.winback(), NULL, 'quiet: no winback');
SELECT is(pg_temp.delivery(id), NULL, 'quiet: no Tuesday note') FROM work WHERE kind = 'followup';
UPDATE public.accounts SET timezone = 'America/New_York' WHERE id = '28000000-0000-0000-0000-000000000001';
SELECT is(pg_temp.call('session_reminder', '2026-10-06T01:05:00Z'), NULL, 'quiet: no hour-before reminder');
DELETE FROM public.session_rsvps WHERE account_id = '28000000-0000-0000-0000-000000000001';
SELECT is(pg_temp.call('family_call_30min', '2026-10-06T01:30:00Z'), NULL, 'quiet: no 30-minute invite');
SELECT ok(pg_get_functiondef('public.dispatcher_outbox_delivery(uuid,uuid)'::regprocedure)
  ~ 'IF o.kind IN \(''family_call_followup'',''group_live'',''community_support''\) AND _account_reminders_paused\(a.id\) THEN RETURN NULL',
  'quiet: no group-live or community notes either');
SELECT ok(pg_get_functiondef('public.dispatcher_outbox_delivery(uuid,uuid)'::regprocedure)
  ~ 'IF o.kind IN \(''invitation_window'',''practice_incoming''\) AND _account_bereaved\(a.id\) THEN RETURN NULL',
  'bereaved: receptivity and practice pushes stay off');

-- ── Kept: alerts and notices that are not reminders ───────────────────────
UPDATE public.loved_ones SET died_at = now(), bereavement_quiet = true WHERE account_id = '28000000-0000-0000-0000-000000000001';
INSERT INTO public.loved_ones(account_id, died_at, bereavement_contact, bereavement_quiet)
SELECT a.id, now(), true, true FROM public.accounts a WHERE a.user_id = '18000000-0000-0000-0000-0000000000ff'
ON CONFLICT (account_id) DO UPDATE SET died_at = now(), bereavement_quiet = true;
INSERT INTO work SELECT 'admin', pg_temp.enqueue('admin_bereavement',
  (SELECT id FROM public.accounts WHERE user_id = '18000000-0000-0000-0000-0000000000ff'),
  jsonb_build_object('member_account_id', a.id)) FROM public.accounts a WHERE a.user_id = '18000000-0000-0000-0000-0000000000ff';
UPDATE public.loved_ones SET bereavement_contact = true WHERE account_id = (SELECT id FROM public.accounts WHERE user_id = '18000000-0000-0000-0000-0000000000ff');
SELECT ok(pg_temp.delivery(id) IS NOT NULL, 'an admin alert is kept even for an admin who paused reminders') FROM work WHERE kind = 'admin';
SELECT ok(pg_get_functiondef('public.dispatcher_outbox_delivery(uuid,uuid)'::regprocedure) !~ '''member_video_[a-z_]+''[^\n]*_account_reminders_paused',
  'session notices she arranged are not part of the pause');

-- ── Turning reminders back on, and undo, restore everything ───────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"18000000-0000-0000-0000-000000000001","email":"bq-a@example.com","role":"authenticated"}', true);
SELECT is(public.set_bereavement_quiet(false), false, 'A turns reminders back on');
RESET ROLE;
SELECT ok(pg_temp.call('family_call_30min', '2026-10-06T01:30:00Z') IS NOT NULL, 'the invite comes back');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"18000000-0000-0000-0000-000000000001","email":"bq-a@example.com","role":"authenticated"}', true);
SELECT public.set_bereavement_quiet(true);
SELECT public.clear_loved_one_died();
RESET ROLE;
SELECT is((SELECT bereavement_quiet FROM public.loved_ones WHERE account_id = '28000000-0000-0000-0000-000000000001'), false, 'undoing "they died" lifts the pause');
SELECT ok(pg_temp.call('family_call_30min', '2026-10-06T01:30:00Z') IS NOT NULL, 'and reminders reach her again');

SELECT * FROM finish();
ROLLBACK;
