BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(14);

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role) VALUES
 ('18000000-0000-0000-0000-000000000001','matt@soberhelpline.com','{}','{}','authenticated','authenticated'),
 ('18000000-0000-0000-0000-000000000002','r1-owner@example.com','{}','{}','authenticated','authenticated'),
 ('18000000-0000-0000-0000-000000000003','r1-relative@example.com','{}','{}','authenticated','authenticated');
UPDATE accounts SET id=('28000000-0000-0000-0000-'||right(user_id::text,12))::uuid, first_name=split_part(user_id::text,'-',5)
 WHERE user_id::text LIKE '18000000-0000-0000-0000-00000000000%';
UPDATE accounts SET push_token='ExponentPushToken[r1-admin]', first_name='Matt' WHERE id='28000000-0000-0000-0000-000000000001';
UPDATE accounts SET first_name='Rosa' WHERE id='28000000-0000-0000-0000-000000000003';

-- ── Leaving a family space hands it to the next member ──────────────────────
INSERT INTO family_spaces(id,name,created_by,invite_code)
VALUES ('78000000-0000-0000-0000-000000000001','Owner','28000000-0000-0000-0000-000000000002','R1R1-0001');
INSERT INTO family_members(family_space_id,account_id,role,joined_at) VALUES
 ('78000000-0000-0000-0000-000000000001','28000000-0000-0000-0000-000000000002','owner', now()-interval '2 days'),
 ('78000000-0000-0000-0000-000000000001','28000000-0000-0000-0000-000000000003','member', now()-interval '1 day');
INSERT INTO shared_walls(id,family_space_id,text,proposed_by)
VALUES ('88000000-0000-0000-0000-000000000001','78000000-0000-0000-0000-000000000001','No cash','28000000-0000-0000-0000-000000000002');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"18000000-0000-0000-0000-000000000002","email":"r1-owner@example.com","role":"authenticated"}',true);
SELECT lives_ok($$SELECT public.leave_family_space()$$, 'the owner can leave their family space');
RESET ROLE;
SELECT is((SELECT created_by FROM family_spaces WHERE id='78000000-0000-0000-0000-000000000001'),
  '28000000-0000-0000-0000-000000000003'::uuid, 'ownership passes to the remaining member');
SELECT is((SELECT count(*)::integer FROM shared_walls WHERE id='88000000-0000-0000-0000-000000000001'), 1,
  'walls the owner proposed stay with the family');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"18000000-0000-0000-0000-000000000003","email":"r1-relative@example.com","role":"authenticated"}',true);
SELECT public.leave_family_space();
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM family_spaces WHERE id='78000000-0000-0000-0000-000000000001'), 0,
  'the last member leaving removes the space');

-- ── Community moderation ─────────────────────────────────────────────────────
INSERT INTO community_posts(id, account_id, body, status, report_count)
VALUES ('98000000-0000-0000-0000-000000000001','28000000-0000-0000-0000-000000000002','A hard week.','held',3);
INSERT INTO community_reports(post_id, reporter_account_id, reason)
VALUES ('98000000-0000-0000-0000-000000000001','28000000-0000-0000-0000-000000000003','spam');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"18000000-0000-0000-0000-000000000003","email":"r1-relative@example.com","role":"authenticated"}',true);
SELECT throws_ok($$SELECT * FROM public.admin_get_reported_community_posts()$$, 'P0001', 'not_authorized', 'members cannot list reports');
SELECT throws_ok($$SELECT public.moderate_community_post('98000000-0000-0000-0000-000000000001','visible')$$, 'P0001', 'not_authorized', 'members cannot moderate');
SELECT set_config('request.jwt.claims','{"sub":"18000000-0000-0000-0000-000000000001","email":"matt@soberhelpline.com","role":"authenticated"}',true);
SELECT is((SELECT count(*)::integer FROM public.admin_get_reported_community_posts()), 1, 'the admin sees the held post');
SELECT lives_ok($$SELECT public.moderate_community_post('98000000-0000-0000-0000-000000000001','visible')$$, 'the admin restores it');
RESET ROLE;
SELECT ok((SELECT status = 'visible' AND report_count = 0 FROM community_posts WHERE id='98000000-0000-0000-0000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM community_reports WHERE post_id='98000000-0000-0000-0000-000000000001'),
  'restoring clears its reports so the next one does not re-hold it');

-- ── Unread Text Line reminder ────────────────────────────────────────────────
INSERT INTO threads(id, account_id, kind) VALUES ('a8000000-0000-0000-0000-000000000001','28000000-0000-0000-0000-000000000002','oncall');
INSERT INTO messages(thread_id, sender_role, body) VALUES ('a8000000-0000-0000-0000-000000000001','member','Are you there?');
SELECT ok((SELECT scheduled_for > now() + interval '9 minutes' AND metadata->>'thread_id' = 'a8000000-0000-0000-0000-000000000001'
           FROM push_outbox WHERE kind='admin_textline_message' AND account_id='28000000-0000-0000-0000-000000000001'),
  'a member message queues a 10-minute unread reminder for the admin');

UPDATE push_outbox SET scheduled_for = now() - interval '1 minute' WHERE kind='admin_textline_message';
UPDATE threads SET last_admin_read_at = now() WHERE id='a8000000-0000-0000-0000-000000000001';
SET LOCAL ROLE service_role;
SELECT is((SELECT count(*)::integer FROM public.claim_push_outbox(50, interval '5 minutes') WHERE kind='admin_textline_message'), 0,
  'a reminder for a thread already read is not sent');
RESET ROLE;
SELECT is((SELECT last_error FROM push_outbox WHERE kind='admin_textline_message'), 'read_before_reminder',
  'it is settled as read');

-- A second message after the admin read, inside the same 10-minute bucket,
-- adds no reminder row of its own; the surviving one must still fire.
INSERT INTO threads(id, account_id, kind) VALUES ('a8000000-0000-0000-0000-000000000002','28000000-0000-0000-0000-000000000003','oncall');
INSERT INTO messages(thread_id, sender_role, body, created_at)
VALUES ('a8000000-0000-0000-0000-000000000002','member','First', now() - interval '4 minutes');
UPDATE threads SET last_admin_read_at = now() - interval '2 minutes' WHERE id='a8000000-0000-0000-0000-000000000002';
INSERT INTO messages(thread_id, sender_role, body) VALUES ('a8000000-0000-0000-0000-000000000002','member','He is back and using');
SELECT is((SELECT count(*)::integer FROM push_outbox WHERE kind='admin_textline_message' AND metadata->>'thread_id'='a8000000-0000-0000-0000-000000000002'), 1,
  'both messages share one reminder in the same bucket');
UPDATE push_outbox SET scheduled_for = now() - interval '1 minute'
 WHERE kind='admin_textline_message' AND metadata->>'thread_id'='a8000000-0000-0000-0000-000000000002';
SET LOCAL ROLE service_role;
SELECT is((SELECT count(*)::integer FROM public.claim_push_outbox(50, interval '5 minutes')
           WHERE kind='admin_textline_message' AND metadata->>'thread_id'='a8000000-0000-0000-0000-000000000002'), 1,
  'the reminder fires because the later message is still unread');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
