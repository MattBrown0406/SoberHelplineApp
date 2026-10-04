-- Notification webhooks move from dashboard-made Database Webhooks to
-- migration-managed triggers that authenticate with the vault service key.
--
-- The dashboard webhooks on public.messages ("Chat Push Notifications ") and
-- public.coaching_bookings ("Coaching Request Notifications") sent the
-- publishable key, which the functions' requireServiceRole rejects, so every
-- chat push and coaching-request email failed with 401. "Live Group Push
-- Notifications " on public.group_hosts posted to the deleted notify-group-live
-- (live-group pushes now go through push_outbox). situation_briefs never had a
-- webhook, so notify-situation-brief was never called.
--
-- The new triggers post the same body a Supabase Database Webhook sends —
-- {type:'INSERT', table, schema, record, old_record:null} — through pg_net
-- (queued, sent after COMMIT; never blocks or fails the member's insert).
-- Chat messages send only the identifiers notify-chat-message reads, never the
-- message body. Re-runnable.

-- Dashboard webhook names carry trailing spaces; drop them exactly.
DROP TRIGGER IF EXISTS "Chat Push Notifications " ON public.messages;
DROP TRIGGER IF EXISTS "Chat Push Notifications" ON public.messages;
DROP TRIGGER IF EXISTS "Coaching Request Notifications" ON public.coaching_bookings;
DROP TRIGGER IF EXISTS "Coaching Request Notifications " ON public.coaching_bookings;
DROP TRIGGER IF EXISTS "Live Group Push Notifications " ON public.group_hosts;
DROP TRIGGER IF EXISTS "Live Group Push Notifications" ON public.group_hosts;

-- The Database Webhook INSERT body. p_keys limits the record to those columns
-- (NULL = the whole row).
CREATE OR REPLACE FUNCTION public._insert_webhook_payload(p_table text, p_schema text, p_record jsonb, p_keys text[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'type', 'INSERT',
    'table', p_table,
    'schema', p_schema,
    'record', CASE
      WHEN p_keys IS NULL THEN p_record
      ELSE coalesce((SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(p_record) e WHERE e.key = ANY (p_keys)), '{}'::jsonb)
    END,
    'old_record', NULL::jsonb
  )
$$;

REVOKE ALL ON FUNCTION public._insert_webhook_payload(text, text, jsonb, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._insert_webhook_payload(text, text, jsonb, text[]) TO service_role;

-- AFTER INSERT trigger: TG_ARGV[0] = Edge Function name (allowlisted),
-- TG_ARGV[1] = optional comma-separated record columns to send.
CREATE OR REPLACE FUNCTION public._post_insert_webhook()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_function text := TG_ARGV[0];
  v_keys text[] := CASE WHEN TG_NARGS > 1 AND nullif(btrim(TG_ARGV[1]), '') IS NOT NULL
                        THEN string_to_array(replace(TG_ARGV[1], ' ', ''), ',') END;
  v_key text;
BEGIN
  IF v_function IS NULL
     OR v_function NOT IN ('notify-chat-message', 'notify-coaching-request', 'notify-situation-brief') THEN
    RAISE WARNING 'webhook trigger %: unknown function %', TG_NAME, v_function;
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'SUPABASE_SERVICE_ROLE_KEY'
  LIMIT 1;
  IF nullif(v_key, '') IS NULL THEN
    RAISE WARNING 'SUPABASE_SERVICE_ROLE_KEY missing from vault; % not called', v_function;
    RETURN NULL;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := 'https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/' || v_function,
      body := public._insert_webhook_payload(TG_TABLE_NAME, TG_TABLE_SCHEMA, to_jsonb(NEW), v_keys),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      timeout_milliseconds := 5000
    );
  EXCEPTION WHEN OTHERS THEN
    -- A notification must never undo the member's message, booking or brief.
    RAISE WARNING '% not queued: %', v_function, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._post_insert_webhook() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS shl_notify_chat_message ON public.messages;
CREATE TRIGGER shl_notify_chat_message
  AFTER INSERT ON public.messages
  FOR EACH ROW
  WHEN (NEW.sender_role IN ('member', 'coach'))
  EXECUTE FUNCTION public._post_insert_webhook('notify-chat-message', 'id,thread_id,sender_role,created_at');

DROP TRIGGER IF EXISTS shl_notify_coaching_request ON public.coaching_bookings;
CREATE TRIGGER shl_notify_coaching_request
  AFTER INSERT ON public.coaching_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public._post_insert_webhook('notify-coaching-request');

DROP TRIGGER IF EXISTS shl_notify_situation_brief ON public.situation_briefs;
CREATE TRIGGER shl_notify_situation_brief
  AFTER INSERT ON public.situation_briefs
  FOR EACH ROW
  EXECUTE FUNCTION public._post_insert_webhook('notify-situation-brief');
