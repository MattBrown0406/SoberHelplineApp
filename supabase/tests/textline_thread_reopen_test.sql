BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT plan(8);

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role)
VALUES ('15000000-0000-0000-0000-000000000001','reopen-member@example.com','{}','{}','authenticated','authenticated');
UPDATE public.accounts SET id='25000000-0000-0000-0000-000000000001', type='direct'
WHERE user_id='15000000-0000-0000-0000-000000000001';
INSERT INTO public.entitlements(account_id,source,tier,expires_at)
VALUES ('25000000-0000-0000-0000-000000000001','scholarship','essential',now()+interval '30 days');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"15000000-0000-0000-0000-000000000001","email":"reopen-member@example.com","role":"authenticated"}',true);

INSERT INTO public.threads(id, account_id, kind)
VALUES ('35000000-0000-0000-0000-000000000001','25000000-0000-0000-0000-000000000001','oncall');
SELECT throws_ok(
  $$INSERT INTO public.threads(account_id, kind) VALUES ('25000000-0000-0000-0000-000000000001','oncall')$$,
  '23505', NULL,
  'a member has at most one active Text Line thread'
);

SELECT lives_ok(
  $$SELECT public.archive_thread('35000000-0000-0000-0000-000000000001')$$,
  'member archives their conversation'
);
SELECT lives_ok(
  $$INSERT INTO public.threads(id, account_id, kind) VALUES ('35000000-0000-0000-0000-000000000002','25000000-0000-0000-0000-000000000001','oncall')$$,
  'after archiving, the member can start a new conversation'
);
SELECT lives_ok(
  $$INSERT INTO public.messages(thread_id, sender_role, body) VALUES ('35000000-0000-0000-0000-000000000002','member','Are you there?')$$,
  'and message in it'
);
RESET ROLE;

INSERT INTO public.situation_briefs(account_id, band) VALUES ('25000000-0000-0000-0000-000000000001','elevated');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"15000000-0000-0000-0000-0000000000ff","email":"matt@soberhelpline.com","role":"authenticated"}',true);
SELECT lives_ok(
  $$SELECT public.admin_send_thread_message('35000000-0000-0000-0000-000000000001','Replying from the old thread')$$,
  'admin can reply from an archived thread'
);
RESET ROLE;

SELECT is(
  (SELECT thread_id FROM public.messages WHERE body='Replying from the old thread'),
  '35000000-0000-0000-0000-000000000002'::uuid,
  'the reply is delivered to the conversation the member has open'
);
SELECT is(
  (SELECT status FROM public.situation_briefs WHERE account_id='25000000-0000-0000-0000-000000000001'),
  'replied',
  'sending a reply marks the member''s outstanding brief replied'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"15000000-0000-0000-0000-0000000000ff","email":"matt@soberhelpline.com","role":"authenticated"}',true);
SELECT is(
  public.admin_get_or_create_thread('25000000-0000-0000-0000-000000000001'),
  '35000000-0000-0000-0000-000000000002'::uuid,
  'admin reply channel resolves to the active thread'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
