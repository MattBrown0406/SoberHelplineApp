-- Durable per-recipient leases for senders that do not use push_outbox.
-- A confirmed ticket is durable; failed attempts release only their own lease.
-- Provider acceptance + database commit are not an atomic distributed transaction.
CREATE TABLE public.push_recipient_deliveries (
 kind text NOT NULL CHECK (kind IN ('family_backup','session_reminder','family_call_30min','winback','preview_session_reminder','preview_family_call_30min')),
 event_key text NOT NULL CHECK (length(event_key) BETWEEN 1 AND 200),
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 processing_token uuid,
 processing_at timestamptz,
 sent_at timestamptz,
 attempt_count integer NOT NULL DEFAULT 0,
 PRIMARY KEY(kind,event_key,account_id)
);
ALTER TABLE public.push_recipient_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_recipient_deliveries FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.push_recipient_deliveries TO service_role;

CREATE FUNCTION public.claim_push_recipient(p_kind text,p_event_key text,p_account_id uuid,p_expires_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE token uuid:=gen_random_uuid(); claimed uuid;
BEGIN
 IF p_expires_at IS NULL OR p_expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
 INSERT INTO push_recipient_deliveries AS d(kind,event_key,account_id,expires_at,processing_token,processing_at,attempt_count)
 VALUES(p_kind,p_event_key,p_account_id,p_expires_at,token,clock_timestamp(),1)
 ON CONFLICT(kind,event_key,account_id) DO UPDATE SET
   processing_token=token,processing_at=clock_timestamp(),attempt_count=d.attempt_count+1,
   expires_at=CASE WHEN p_kind='winback' AND (d.sent_at<=clock_timestamp()-interval '7 days' OR d.expires_at<=clock_timestamp()) THEN p_expires_at ELSE least(d.expires_at,p_expires_at) END,
   sent_at=NULL
 WHERE (d.processing_token IS NULL OR d.processing_at<=clock_timestamp()-interval '5 minutes')
   AND ((d.sent_at IS NULL AND (d.expires_at>clock_timestamp() OR p_kind='winback'))
     OR (p_kind='winback' AND d.sent_at<=clock_timestamp()-interval '7 days'))
 RETURNING processing_token INTO claimed;
 RETURN claimed;
END $$;

CREATE FUNCTION public.finish_push_recipient(p_kind text,p_event_key text,p_account_id uuid,p_processing_token uuid,p_accepted boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF p_accepted IS NULL THEN RAISE EXCEPTION 'accepted_required'; END IF;
 UPDATE push_recipient_deliveries SET sent_at=CASE WHEN p_accepted THEN clock_timestamp() ELSE NULL END,
   processing_token=NULL,processing_at=NULL
 WHERE kind=p_kind AND event_key=p_event_key AND account_id=p_account_id
   AND processing_token=p_processing_token AND sent_at IS NULL;
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_accepted AND p_kind='winback' THEN
   UPDATE accounts SET last_winback_at=clock_timestamp() WHERE id=p_account_id;
 END IF;
 RETURN true;
END $$;

-- Force previews have a separate occurrence namespace and never consume the
-- real scheduled occurrence. Repeated/concurrent previews of it deduplicate.
CREATE FUNCTION public.claim_dispatcher_job(p_job text,p_account_id uuid,p_session_id uuid,p_expires_at timestamptz,p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE delivery jsonb; token uuid; kind text; event_key text; original_deadline timestamptz;
BEGIN
 delivery:=dispatcher_job_delivery(p_job,p_account_id,p_session_id,p_expires_at,clock_timestamp(),p_force);
 IF delivery IS NULL THEN RETURN NULL; END IF;
 kind:=CASE WHEN p_force AND p_job<>'winback' THEN 'preview_'||p_job ELSE p_job END;
 event_key:=CASE WHEN p_job='winback' THEN 'cooldown' ELSE p_session_id::text||':'||extract(epoch FROM p_expires_at)::text END;
 token:=claim_push_recipient(kind,event_key,p_account_id,p_expires_at);
 IF token IS NULL THEN RETURN NULL; END IF;
 -- A conflicting claimant can block until COMMIT: re-read permission/token
 -- after acquiring the lease instead of returning a pre-lock snapshot.
 delivery:=dispatcher_job_delivery(p_job,p_account_id,p_session_id,p_expires_at,clock_timestamp(),p_force);
 IF delivery IS NULL THEN
   PERFORM finish_push_recipient(kind,event_key,p_account_id,token,false);
   RETURN NULL;
 END IF;
 SELECT d.expires_at INTO original_deadline FROM push_recipient_deliveries d
 WHERE d.processing_token=token AND d.account_id=p_account_id;
 RETURN delivery||jsonb_build_object('processing_token',token,'reservation_kind',kind,'event_key',event_key,
   'expires_at',original_deadline,'ttl',greatest(0,floor(extract(epoch FROM original_deadline-clock_timestamp()))::integer));
END $$;
REVOKE ALL ON FUNCTION public.claim_push_recipient(text,text,uuid,timestamptz),public.finish_push_recipient(text,text,uuid,uuid,boolean),public.claim_dispatcher_job(text,uuid,uuid,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_recipient(text,text,uuid,timestamptz),public.finish_push_recipient(text,text,uuid,uuid,boolean),public.claim_dispatcher_job(text,uuid,uuid,timestamptz,boolean) TO service_role;

-- The client invokes family backup only once. Retry discovery from the durable
-- source, even when the first request failed before reserving any recipient.
-- Current consent, owner, membership, token and local-day expiry remain enforced
-- by the handler. Accepted recipients are excluded by their durable reservation.
CREATE FUNCTION public.retry_notification_deliveries() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE secret text; event_id uuid; job text; headers jsonb;
BEGIN
 SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;
 IF nullif(secret,'') IS NULL THEN RETURN; END IF;
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret);
 FOR event_id IN SELECT e.id FROM wavering_events e
   WHERE e.shared_with_family AND e.notification_claimed_at IS NULL
     AND e.created_at>now()-interval '10 minutes' AND e.created_at<=now()
 LOOP
   PERFORM net.http_post(url:='https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/notify-family-backup',
     headers:=headers,body:=jsonb_build_object('wavering_event_id',event_id));
 END LOOP;
 -- Re-run call discovery throughout its real delivery window, including a
 -- failed initial discovery. Winback failures retry while their deadline lasts.
 -- Preview reservations are deliberately never promoted into scheduled sends.
 FOR job IN
   SELECT unnest(ARRAY['session_reminder','family_call_30min'])
     WHERE extract(isodow FROM now() AT TIME ZONE 'America/Los_Angeles')=1
       AND (now() AT TIME ZONE 'America/Los_Angeles')::time>=time '18:00'
       AND (now() AT TIME ZONE 'America/Los_Angeles')::time<time '19:00'
   UNION SELECT 'winback' WHERE EXISTS(SELECT 1 FROM push_recipient_deliveries
     WHERE kind='winback' AND sent_at IS NULL AND expires_at>now()
       AND (processing_token IS NULL OR processing_at<now()-interval '5 minutes'))
 LOOP
   PERFORM net.http_post(url:='https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/send-engagement-push',
     headers:=headers,body:=jsonb_build_object('job',job,'force',false));
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.retry_notification_deliveries() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retry_notification_deliveries() TO service_role;
SELECT cron.schedule('shl-notification-retry','* * * * *','SELECT public.retry_notification_deliveries()');
