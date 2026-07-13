BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path = public, extensions;

SELECT plan(28);

INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data, aud, role)
VALUES
  ('51000000-0000-0000-0000-000000000001', 'matt@soberhelpline.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('51000000-0000-0000-0000-000000000002', 'group-member-a@example.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('51000000-0000-0000-0000-000000000003', 'group-member-b@example.com', '{}', '{}', 'authenticated', 'authenticated'),
  ('51000000-0000-0000-0000-000000000004', 'group-attacker@example.com', '{}', '{}', 'authenticated', 'authenticated');

INSERT INTO public.group_hosts(room_name, account_id)
VALUES ('shp-parents', (SELECT id FROM accounts WHERE user_id='51000000-0000-0000-0000-000000000001'));

SELECT ok(has_function_privilege('authenticated', 'public.set_group_rsvp(text,boolean)', 'EXECUTE'), 'authenticated can use validated RSVP RPC');
SELECT ok(NOT has_function_privilege('anon', 'public.set_group_rsvp(text,boolean)', 'EXECUTE'), 'anonymous cannot use RSVP RPC');
SELECT ok(has_table_privilege('authenticated', 'public.group_rsvps', 'INSERT'), 'installed clients retain constrained direct RSVP inserts');
SELECT ok(has_table_privilege('authenticated', 'public.group_rsvps', 'DELETE'), 'installed clients retain own RSVP removal');
SELECT is((SELECT count(*)::integer FROM pg_policies WHERE schemaname='public' AND tablename='group_rsvps' AND cmd IN ('INSERT','UPDATE','DELETE')), 3, 'compatibility writes have explicit RLS policies');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='get_group_rsvp_push_tokens'), 'legacy push-token RPC is removed');
SELECT ok(position('LOCK TABLE public.group_rsvps IN SHARE MODE' in pg_get_functiondef('public.set_host_live(text,boolean)'::regprocedure)) > 0, 'Go Live serializes against concurrent legacy and RPC RSVP writes');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"51000000-0000-0000-0000-000000000002","email":"group-member-a@example.com","role":"authenticated"}',true);
SELECT throws_ok($$SELECT public.set_group_rsvp('attacker-room',true)$$, '22023', 'invalid_group_room', 'unknown group room is rejected');
SELECT is(public.set_group_rsvp('shp-parents',true), true, 'member A enables notification');
SELECT is(public.set_group_rsvp('shp-parents',true), true, 'repeat enable is idempotent');

RESET ROLE;
SELECT is((SELECT count(*)::integer FROM group_rsvps WHERE account_id=(SELECT id FROM accounts WHERE user_id='51000000-0000-0000-0000-000000000002') AND room_name='shp-parents'), 1, 'repeat enable creates one RSVP');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"51000000-0000-0000-0000-000000000003","email":"group-member-b@example.com","role":"authenticated"}',true);
SELECT is(public.set_group_rsvp('shp-parents',true), true, 'member B enables notification');
SELECT lives_ok($$INSERT INTO public.group_rsvps(account_id,room_name) VALUES (public.my_account_id(),'shp-spouses')$$, 'installed client can still RSVP to a configured room');

SELECT set_config('request.jwt.claims','{"sub":"51000000-0000-0000-0000-000000000004","email":"group-attacker@example.com","role":"authenticated"}',true);
SELECT throws_ok($$SELECT public.set_host_live('shp-parents',true)$$, '42501', 'not_group_host', 'non-host cannot start a group');

SELECT set_config('request.jwt.claims','{"sub":"51000000-0000-0000-0000-000000000001","email":"matt@soberhelpline.com","role":"authenticated"}',true);
SELECT lives_ok($$SELECT public.set_host_live('shp-parents',true)$$, 'authorized host starts group');

RESET ROLE;
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE kind='group_live' AND metadata->>'room_name'='shp-parents'), 2, 'first broadcast queues one push per subscriber');
SELECT is((SELECT count(DISTINCT account_id)::integer FROM push_outbox WHERE kind='group_live' AND metadata->>'room_name'='shp-parents'), 2, 'first broadcast targets two distinct subscriber accounts');
SELECT ok((SELECT bool_and(metadata->>'kind'='group_live' AND metadata->>'screen'='live-room' AND metadata->>'deep_link'='sober-helpline://live-room?room=shp-parents' AND metadata ? 'event_id') FROM push_outbox WHERE kind='group_live'), 'group push metadata has validated routing, registered scheme, and event identity');
SELECT is((SELECT count(DISTINCT idempotency_key)::integer FROM push_outbox WHERE kind='group_live'), 2, 'first broadcast idempotency keys are unique per recipient');
SELECT ok((SELECT is_live AND live_event_id IS NOT NULL AND live_started_at IS NOT NULL FROM group_hosts WHERE room_name='shp-parents'), 'host row records active broadcast identity and start time');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"51000000-0000-0000-0000-000000000001","email":"matt@soberhelpline.com","role":"authenticated"}',true);
SELECT lives_ok($$SELECT public.set_host_live('shp-parents',true)$$, 'repeat live=true is harmless');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE kind='group_live'), 2, 'repeat live=true does not duplicate pushes');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"51000000-0000-0000-0000-000000000003","email":"group-member-b@example.com","role":"authenticated"}',true);
SELECT is(public.set_group_rsvp('shp-parents',false), false, 'member B disables notification');
SELECT set_config('request.jwt.claims','{"sub":"51000000-0000-0000-0000-000000000001","email":"matt@soberhelpline.com","role":"authenticated"}',true);
SELECT lives_ok($$SELECT public.set_host_live('shp-parents',false); SELECT public.set_host_live('shp-parents',true)$$, 'host can end and begin a new broadcast');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE kind='group_live'), 3, 'new broadcast queues only the remaining subscriber');
SELECT is((SELECT count(DISTINCT metadata->>'event_id')::integer FROM push_outbox WHERE kind='group_live'), 2, 'new broadcast receives a distinct event identity');
SELECT is((SELECT count(*)::integer FROM group_rsvps WHERE room_name='shp-parents'), 1, 'disabled subscriber remains removed');
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE kind='group_live' AND metadata->>'room_name' NOT IN ('shp-parents','shp-spouses','shp-boundaries','shp-treatment')), 0, 'no invalid room notification can be queued');

SELECT * FROM finish();
ROLLBACK;
