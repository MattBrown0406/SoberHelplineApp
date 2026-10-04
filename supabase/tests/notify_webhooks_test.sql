BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET search_path=public,extensions;
SELECT no_plan();

-- pg_net only sends COMMITTED requests; this transaction always rolls back.

SELECT is(
  (SELECT count(*)::integer FROM pg_trigger
   WHERE NOT tgisinternal AND tgname IN ('Chat Push Notifications ', 'Coaching Request Notifications', 'Live Group Push Notifications ')),
  0, 'dashboard webhooks with the publishable key are gone');
SELECT is(
  (SELECT count(*)::integer FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE NOT t.tgisinternal AND p.pronamespace = 'supabase_functions'::regnamespace
     AND t.tgrelid IN ('public.messages'::regclass, 'public.coaching_bookings'::regclass,
                       'public.group_hosts'::regclass, 'public.situation_briefs'::regclass)),
  0, 'no supabase_functions.http_request webhook remains on these tables');
SELECT ok(EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'shl_notify_chat_message' AND tgrelid = 'public.messages'::regclass AND tgenabled = 'O'), 'chat trigger exists');
SELECT ok(EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'shl_notify_coaching_request' AND tgrelid = 'public.coaching_bookings'::regclass AND tgenabled = 'O'), 'coaching trigger exists');
SELECT ok(EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'shl_notify_situation_brief' AND tgrelid = 'public.situation_briefs'::regclass AND tgenabled = 'O'), 'situation brief trigger exists');
SELECT ok(NOT has_function_privilege('authenticated', 'public._post_insert_webhook()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._insert_webhook_payload(text,text,jsonb,text[])', 'EXECUTE'),
  'webhook helpers are not client-callable');

SELECT is(
  public._insert_webhook_payload('coaching_bookings', 'public', '{"id":"x","note":"n"}'::jsonb),
  '{"type":"INSERT","table":"coaching_bookings","schema":"public","record":{"id":"x","note":"n"},"old_record":null}'::jsonb,
  'payload is the Database Webhook INSERT shape');
SELECT is(
  public._insert_webhook_payload('messages', 'public', '{"id":"m","thread_id":"t","body":"secret"}'::jsonb, ARRAY['id','thread_id']),
  '{"type":"INSERT","table":"messages","schema":"public","record":{"id":"m","thread_id":"t"},"old_record":null}'::jsonb,
  'payload record can be limited to named columns');

INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,aud,role)
VALUES('a4000000-0000-0000-0000-000000000001','webhook@example.invalid','{}','{"first_name":"Hook"}','authenticated','authenticated');
INSERT INTO public.threads(id, account_id, kind)
VALUES ('a4000000-0000-0000-0000-000000000011', (SELECT id FROM accounts WHERE user_id='a4000000-0000-0000-0000-000000000001'), 'oncall');

-- No vault secret: the insert still succeeds and nothing is queued.
SELECT lives_ok($$INSERT INTO public.messages(id, thread_id, sender_role, body)
  VALUES ('a4000000-0000-0000-0000-000000000021','a4000000-0000-0000-0000-000000000011','member','first')$$,
  'a message is saved even when the service key is missing');
SELECT is((SELECT count(*)::integer FROM net.http_request_queue WHERE url LIKE '%/notify-chat-message'), 0, 'missing key queues nothing');

SELECT vault.create_secret('synthetic-webhook-key','SUPABASE_SERVICE_ROLE_KEY');

INSERT INTO public.messages(id, thread_id, sender_role, body)
VALUES ('a4000000-0000-0000-0000-000000000022','a4000000-0000-0000-0000-000000000011','member','private words');
INSERT INTO public.messages(id, thread_id, sender_role, body)
VALUES ('a4000000-0000-0000-0000-000000000023','a4000000-0000-0000-0000-000000000011','system','system note');

CREATE TEMP TABLE chat_req AS
SELECT url, headers, convert_from(body,'UTF8')::jsonb AS payload, timeout_milliseconds
FROM net.http_request_queue WHERE url LIKE '%/notify-chat-message';
SELECT is((SELECT count(*)::integer FROM chat_req), 1, 'member message queues one chat webhook; system messages none');
SELECT is((SELECT url FROM chat_req), 'https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/notify-chat-message', 'chat webhook URL');
SELECT is((SELECT headers->>'Authorization' FROM chat_req), 'Bearer synthetic-webhook-key', 'chat webhook uses the vault service key');
SELECT is((SELECT payload->>'type' FROM chat_req), 'INSERT', 'chat payload type');
SELECT is((SELECT payload->>'table' FROM chat_req), 'messages', 'chat payload table');
SELECT is((SELECT payload->'record'->>'id' FROM chat_req), 'a4000000-0000-0000-0000-000000000022', 'chat payload record id');
SELECT is((SELECT payload->'record'->>'thread_id' FROM chat_req), 'a4000000-0000-0000-0000-000000000011', 'chat payload thread id');
SELECT ok((SELECT NOT (payload->'record' ? 'body') FROM chat_req), 'message body never leaves in the webhook');
SELECT ok((SELECT payload ? 'old_record' AND payload->'old_record' = 'null'::jsonb FROM chat_req), 'old_record is null');

INSERT INTO public.coaching_bookings(id, account_id, preferred_times, note)
VALUES ('a4000000-0000-0000-0000-000000000031', (SELECT id FROM accounts WHERE user_id='a4000000-0000-0000-0000-000000000001'), 'Mon evening', 'Contact: x@example.invalid');
CREATE TEMP TABLE coaching_req AS
SELECT url, headers, convert_from(body,'UTF8')::jsonb AS payload
FROM net.http_request_queue WHERE url LIKE '%/notify-coaching-request';
SELECT is((SELECT count(*)::integer FROM coaching_req), 1, 'coaching booking queues one webhook');
SELECT is((SELECT headers->>'Authorization' FROM coaching_req), 'Bearer synthetic-webhook-key', 'coaching webhook uses the vault service key');
SELECT is((SELECT payload->'record'->>'preferred_times' FROM coaching_req), 'Mon evening', 'coaching payload carries the full row');
SELECT ok((SELECT payload->'record' ? 'rate_cents' FROM coaching_req), 'coaching payload carries the quoted rate');

INSERT INTO public.situation_briefs(id, account_id, band, score)
VALUES ('a4000000-0000-0000-0000-000000000041', (SELECT id FROM accounts WHERE user_id='a4000000-0000-0000-0000-000000000001'), 'elevated', 40);
SELECT is((SELECT count(*)::integer FROM net.http_request_queue WHERE url = 'https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/notify-situation-brief'
  AND convert_from(body,'UTF8')::jsonb->'record'->>'id' = 'a4000000-0000-0000-0000-000000000041'
  AND convert_from(body,'UTF8')::jsonb->>'table' = 'situation_briefs'
  AND headers->>'Authorization' = 'Bearer synthetic-webhook-key'), 1, 'situation brief calls notify-situation-brief');
SELECT is((SELECT count(*)::integer FROM net.http_request_queue WHERE url LIKE '%notify-group-live%'), 0, 'nothing posts to the deleted notify-group-live');

SELECT * FROM finish();
ROLLBACK;
