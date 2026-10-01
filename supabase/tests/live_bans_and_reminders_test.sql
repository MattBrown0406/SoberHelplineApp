BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(14);

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role) VALUES
 ('17000000-0000-0000-0000-000000000001','matt@soberhelpline.com','{}','{}','authenticated','authenticated'),
 ('17000000-0000-0000-0000-000000000002','ban-member@example.com','{}','{}','authenticated','authenticated'),
 ('17000000-0000-0000-0000-000000000003','reminder-member@example.com','{}','{}','authenticated','authenticated');
UPDATE accounts SET id=('27000000-0000-0000-0000-'||right(user_id::text,12))::uuid
 WHERE user_id::text LIKE '17000000-0000-0000-0000-00000000000%';
INSERT INTO entitlements(account_id,source,tier,expires_at)
VALUES ('27000000-0000-0000-0000-000000000002','scholarship','essential',now()+interval '30 days');
UPDATE accounts SET push_token='ExponentPushToken[reminder-a]' WHERE id='27000000-0000-0000-0000-000000000002';
UPDATE accounts SET push_token='ExponentPushToken[reminder-b]' WHERE id='27000000-0000-0000-0000-000000000003';

-- ── Removal is a ban ─────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"17000000-0000-0000-0000-000000000002","email":"ban-member@example.com","role":"authenticated"}',true);
SELECT is(public.set_group_rsvp('shp-parents', true), true, 'member RSVPs to a group');
SELECT throws_ok($$SELECT public.admin_ban_from_live_groups('27000000-0000-0000-0000-000000000003','shp-parents')$$,
  '42501', 'not_authorized', 'members cannot ban anyone');

SELECT set_config('request.jwt.claims','{"sub":"17000000-0000-0000-0000-000000000001","email":"matt@soberhelpline.com","role":"authenticated"}',true);
SELECT lives_ok($$SELECT public.admin_ban_from_live_groups('27000000-0000-0000-0000-000000000002','shp-parents')$$,
  'the admin host removes a member');
SELECT is((SELECT count(*)::integer FROM public.admin_get_live_group_bans()), 1, 'the admin sees the removed member');

SELECT set_config('request.jwt.claims','{"sub":"17000000-0000-0000-0000-000000000002","email":"ban-member@example.com","role":"authenticated"}',true);
SELECT ok(public.am_banned_from_live_groups(), 'the removed member is banned');
SELECT throws_ok($$SELECT public.set_group_rsvp('shp-spouses', true)$$, '42501', 'removed_from_live_groups',
  'a removed member cannot RSVP to any group');
SELECT throws_ok($$INSERT INTO public.group_rsvps(account_id, room_name) VALUES (public.my_account_id(), 'shp-spouses')$$,
  '42501', NULL, 'nor through the direct insert older apps use');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM group_rsvps WHERE account_id='27000000-0000-0000-0000-000000000002'), 0,
  'removal clears their RSVPs so no go-live push invites them');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"17000000-0000-0000-0000-000000000001","email":"matt@soberhelpline.com","role":"authenticated"}',true);
SELECT public.admin_lift_live_group_ban('27000000-0000-0000-0000-000000000002');
SELECT set_config('request.jwt.claims','{"sub":"17000000-0000-0000-0000-000000000002","email":"ban-member@example.com","role":"authenticated"}',true);
SELECT ok(NOT public.am_banned_from_live_groups(), 'an admin can let them back in');

-- ── 30-minute call reminder honors opt-out and skips RSVPs ──────────────────
SELECT set_config('request.jwt.claims','{"sub":"17000000-0000-0000-0000-000000000003","email":"reminder-member@example.com","role":"authenticated"}',true);
SELECT public.set_family_call_reminders(false);
RESET ROLE;
SELECT is((SELECT array_agg(push_token ORDER BY push_token) FROM public.get_family_call_30min_targets()),
  ARRAY['ExponentPushToken[reminder-a]'], 'opted-out members are not reminded');
INSERT INTO session_rsvps(session_id, account_id, status)
VALUES (public.family_squares_session_id(), '27000000-0000-0000-0000-000000000002', 'going');
SELECT is((SELECT count(*)::integer FROM public.get_family_call_30min_targets()), 0,
  'members who RSVP''d get the existing reminders instead');
UPDATE session_rsvps SET status = 'declined'
 WHERE session_id = public.family_squares_session_id() AND account_id = '27000000-0000-0000-0000-000000000002';
SELECT is((SELECT count(*)::integer FROM public.get_family_call_30min_targets()), 0,
  'members who declined this week are not told to tap to join');

-- ── Password reset requests are rate limited ────────────────────────────────
SELECT is(
  (SELECT count(*)::integer FROM generate_series(1, 4) g
   WHERE public.register_password_reset_request(repeat('a', 64), repeat('b', 64))),
  3, 'three resets per email per hour');
SELECT ok(NOT has_function_privilege('anon', 'public.register_password_reset_request(text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.register_password_reset_request(text,text)', 'EXECUTE'),
  'only the reset function (service role) can register requests');

SELECT * FROM finish();
ROLLBACK;
