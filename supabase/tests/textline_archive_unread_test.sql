BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(5);

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role)
VALUES ('15100000-0000-0000-0000-000000000001','archive-member@example.com','{}','{}','authenticated','authenticated');
UPDATE public.accounts SET id='25100000-0000-0000-0000-000000000001', type='direct'
WHERE user_id='15100000-0000-0000-0000-000000000001';
INSERT INTO public.entitlements(account_id,source,tier,expires_at)
VALUES ('25100000-0000-0000-0000-000000000001','scholarship','essential',now()+interval '30 days');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"15100000-0000-0000-0000-000000000001","email":"archive-member@example.com","role":"authenticated"}',true);
INSERT INTO public.threads(id, account_id, kind)
VALUES ('35100000-0000-0000-0000-000000000001','25100000-0000-0000-0000-000000000001','oncall');
INSERT INTO public.messages(thread_id, sender_role, body)
VALUES ('35100000-0000-0000-0000-000000000001','member','He is threatening me, please call');
SELECT public.archive_thread('35100000-0000-0000-0000-000000000001');
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"15100000-0000-0000-0000-0000000000ff","email":"matt@soberhelpline.com","role":"authenticated"}',true);
SELECT ok(
  EXISTS(SELECT 1 FROM public.admin_get_active_threads() WHERE thread_id='35100000-0000-0000-0000-000000000001' AND unread_count=1),
  'a thread the member archived with an unread message stays in the coach inbox'
);
RESET ROLE;

SELECT ok(
  (SELECT archived_at IS NOT NULL AND last_member_message_at IS NOT NULL FROM public.threads WHERE id='35100000-0000-0000-0000-000000000001'),
  'the thread really is archived with a member message on file'
);
SELECT ok(
  position('t.archived_at IS NULL' in (SELECT prosrc FROM pg_proc WHERE proname='dispatcher_outbox_delivery')) = 0,
  'the unread Text Line reminder no longer requires an unarchived thread'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"15100000-0000-0000-0000-0000000000ff","email":"matt@soberhelpline.com","role":"authenticated"}',true);
SELECT public.admin_mark_thread_read('35100000-0000-0000-0000-000000000001');
SELECT ok(
  NOT EXISTS(SELECT 1 FROM public.admin_get_active_threads() WHERE thread_id='35100000-0000-0000-0000-000000000001'),
  'once read, the archived thread leaves the inbox'
);
RESET ROLE;

INSERT INTO public.threads(id, account_id, kind)
VALUES ('35100000-0000-0000-0000-000000000002','25100000-0000-0000-0000-000000000001','oncall');
INSERT INTO public.messages(thread_id, sender_role, body)
VALUES ('35100000-0000-0000-0000-000000000002','member','Another note');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"15100000-0000-0000-0000-0000000000ff","email":"matt@soberhelpline.com","role":"authenticated"}',true);
SELECT public.archive_thread('35100000-0000-0000-0000-000000000002');
SELECT ok(
  NOT EXISTS(SELECT 1 FROM public.admin_get_active_threads() WHERE thread_id='35100000-0000-0000-0000-000000000002'),
  'a thread the coach archives himself counts as handled'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
