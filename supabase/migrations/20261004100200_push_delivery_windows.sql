-- Push delivery fixes. Re-runnable.
--
-- 1. A member paying for her plan review bumped the session version, and the
--    staff "New plan review request" push (queued with the request's version)
--    was then dropped as stale. A version bump made only by payment events no
--    longer makes that request push ineligible.
-- 2. Family Squares reminders went out late: the retry sweep re-ran both jobs
--    every minute until 7:00 PM Pacific, so "starts in about an hour" could
--    arrive at 6:55. "About an hour" is now sent only 6:00–6:15 PM Pacific
--    (shown until 6:30) and "in 30 minutes" only 6:30–6:40 (shown until 6:45).
-- 3. After a failed winback, the sweep re-ran the whole winback job every
--    minute for 24 hours, at any hour. Now: winbacks go out only 9 AM–8 PM in
--    the member's own time zone (accounts.timezone); a retry re-sends only the
--    failed reservations (dispatcher_winback_retry_targets, ≤ 5 attempts);
--    and a permanent failure (DeviceNotRegistered) is finished, not retried.
-- 4. "The app reminds her" (website hand-off) meant only "a push token is
--    stored". It now requires a token the app re-registered in the last 30
--    days (accounts.push_token_seen_at, set by register_push_device on every
--    app launch) AND the Monday call reminder on — exactly what the dispatcher
--    requires. Existing tokens start unconfirmed (NULL), so the website keeps
--    emailing a member until her app checks in.
-- 5. An Essential member whose $150 plan review is still awaiting payment
--    never heard that her coach proposed a new time or asked for an updated
--    plan (both are queued before she pays). Those two notices now reach a
--    one-off whose payment is pending or paid, and her paying does not make
--    them stale. Every other active-session notice still needs a paid one-off
--    (or Premier/org access).
-- 6. "Someone sent you support" goes out only 9 AM–9 PM in the author's own
--    time zone (support_community_post queues a night-time heart for 9 AM;
--    20261004100600) and is never shown after 9 PM, and only while someone she
--    has not blocked still supports the post.
-- 7. Matt hears about a post that went up with the 988/911 note
--    (admin_community_report with reason 'crisis') even when nobody reported it.

-- ── 1. Plan-review request push survives payment ─────────────────────────────
-- True when every version after p_from (up to p_to) was made by a payment event
-- and nothing else.
CREATE OR REPLACE FUNCTION public._video_versions_payment_only(p_session uuid, p_from integer, p_to integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_from IS NOT NULL AND p_to IS NOT NULL AND p_from < p_to AND p_to - p_from <= 10
    AND NOT EXISTS (
      SELECT 1 FROM generate_series(p_from + 1, p_to) AS v(n)
      WHERE NOT EXISTS (
              SELECT 1 FROM video_session_events e
              WHERE e.session_id = p_session AND e.session_version = v.n
                AND e.event_type IN ('payment_verified', 'payment_failed', 'payment_marked_paid_manually'))
         OR EXISTS (
              SELECT 1 FROM video_session_events e
              WHERE e.session_id = p_session AND e.session_version = v.n
                AND e.event_type NOT IN ('payment_verified', 'payment_failed', 'payment_marked_paid_manually')))
$$;

REVOKE ALL ON FUNCTION public._video_versions_payment_only(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._video_versions_payment_only(uuid, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.dispatcher_outbox_delivery(p_outbox_id uuid,p_processing_token uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE o push_outbox; a accounts; s video_sessions; deadline timestamptz; allowed boolean:=false; ttl integer;
  tz text; member_now timestamp;
BEGIN
 SELECT * INTO o FROM push_outbox WHERE id=p_outbox_id AND processing_token=p_processing_token
 AND processing_at>now()-interval '5 minutes' AND sent_at IS NULL AND failed_at IS NULL AND scheduled_for<=now();
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO a FROM accounts WHERE id=o.account_id;
 IF NOT FOUND OR nullif(a.push_token,'') IS NULL THEN RETURN NULL; END IF;
 deadline:=o.expires_at;
 CASE o.kind
 WHEN 'invitation_window' THEN
   ttl:=invitation_push_delivery_ttl(o.id,p_processing_token); allowed:=ttl>0;
 WHEN 'practice_incoming' THEN
   ttl:=practice_push_delivery_ttl((o.metadata->>'event_id')::uuid,o.account_id);
   allowed:=ttl>0 AND deadline IS NOT NULL AND EXISTS(SELECT 1 FROM practice_push_events e
     WHERE e.event_id::text=o.metadata->>'event_id' AND e.account_id=o.account_id AND e.expires_at>=deadline);
 WHEN 'group_live' THEN
   allowed:=_dispatcher_member_access(a.id) AND NOT EXISTS(SELECT 1 FROM live_group_bans WHERE account_id=a.id)
     AND EXISTS(SELECT 1 FROM group_rsvps r WHERE r.account_id=a.id AND r.room_name=o.metadata->>'room_name')
     AND EXISTS(SELECT 1 FROM group_hosts h WHERE h.room_name=o.metadata->>'room_name'
       AND h.live_event_id::text=o.metadata->>'event_id' AND h.is_live AND _dispatcher_admin(h.account_id)
       AND h.live_started_at>now()-interval '3 hours');
 WHEN 'community_support' THEN
   -- 9 AM–9 PM in her time zone, never shown after 9 PM; only while someone
   -- she has not blocked still supports the post.
   tz:=_invitation_valid_tz(a.timezone);
   member_now:=now() AT TIME ZONE tz;
   deadline:=least(coalesce(deadline,'infinity'::timestamptz),(member_now::date+time '21:00') AT TIME ZONE tz);
   allowed:=member_now::time>=time '09:00' AND member_now::time<time '21:00'
     AND EXISTS(SELECT 1 FROM community_posts p WHERE p.id::text=o.metadata->>'post_id'
     AND p.account_id=a.id AND p.status='visible' AND EXISTS(SELECT 1 FROM community_supports c
       WHERE c.post_id=p.id AND c.supporter_account_id<>a.id
         AND NOT EXISTS(SELECT 1 FROM member_blocks b
           WHERE b.blocker_account_id=a.id AND b.blocked_account_id=c.supporter_account_id)));
 WHEN 'admin_community_report' THEN
   -- Reports cleared by a restore no longer need review. A post that went up
   -- with the 988/911 note (reason 'crisis') needs Matt's eyes unreported.
   allowed:=_dispatcher_admin(a.id) AND EXISTS(SELECT 1 FROM community_posts p
     WHERE p.id::text=o.metadata->>'post_id' AND p.status<>'removed'
       AND ((o.metadata->>'reason' IS NOT DISTINCT FROM 'crisis' AND p.crisis_reviewed_at IS NULL)
         OR EXISTS(SELECT 1 FROM community_reports r WHERE r.post_id=p.id AND r.cleared_at IS NULL)));
 WHEN 'situation_brief' THEN
   allowed:=_dispatcher_admin(a.id) AND EXISTS(SELECT 1 FROM situation_briefs b WHERE b.id::text=o.metadata->>'brief_id' AND b.status='sent' AND b.read_at IS NULL AND b.replied_at IS NULL);
 WHEN 'admin_invitation_yes' THEN
   allowed:=_dispatcher_admin(a.id) AND EXISTS(SELECT 1 FROM invitation_attempts t
     WHERE t.id::text=split_part(o.idempotency_key,':',2) AND t.outcome='yes');
 WHEN 'admin_textline_message' THEN
   allowed:=_dispatcher_admin(a.id) AND EXISTS(SELECT 1 FROM threads t WHERE t.id::text=o.metadata->>'thread_id'
     AND t.kind='oncall' AND t.status='active' AND t.archived_at IS NULL AND t.account_id<>a.id AND t.last_member_message_at IS NOT NULL
     AND (t.last_admin_read_at IS NULL OR t.last_admin_read_at<t.last_member_message_at));
 WHEN 'admin_refund_owed' THEN
   -- Retain unpaid operational obligations, not alerts already refunded.
   allowed:=is_video_owner(a.id) AND EXISTS(SELECT 1 FROM video_sessions v WHERE v.id::text=o.metadata->>'session_id'
     AND ((v.status='cancelled' AND v.payment_status='paid') OR
       ((v.appointment_type='membership_included' OR v.status NOT IN ('requested','scheduled','live'))
        AND EXISTS(SELECT 1 FROM plan_review_payment_events e WHERE e.session_id=v.id AND e.payment_status='captured'
          AND NOT EXISTS(SELECT 1 FROM plan_review_payment_events r WHERE r.paypal_capture_id=e.paypal_capture_id AND r.payment_status IN ('refunded','reversed')))) OR
       (SELECT count(DISTINCT e.paypal_capture_id) FROM plan_review_payment_events e WHERE e.session_id=v.id AND e.payment_status='captured'
          AND NOT EXISTS(SELECT 1 FROM plan_review_payment_events r WHERE r.paypal_capture_id=e.paypal_capture_id AND r.payment_status IN ('refunded','reversed')))>1));
 ELSE
   IF o.kind IN ('admin_video_request','member_video_scheduled','member_video_counteroffer',
     'member_video_live','member_video_cancelled','member_video_completed','member_video_no_show',
     'coach_video_accepted','coach_video_cancelled','coach_video_reschedule','premier_video_reminder','coach_video_reminder','member_plan_update_requested') THEN
     SELECT * INTO s FROM video_sessions WHERE id::text=o.metadata->>'session_id';
     allowed:=FOUND AND (s.version::text=o.metadata->>'delivery_version'
         -- Paying for the request does not make "new request", "new time
         -- proposed" or "plan update requested" stale.
         OR (o.kind IN ('admin_video_request','member_video_counteroffer','member_plan_update_requested')
             AND coalesce(o.metadata->>'delivery_version','') ~ '^[0-9]{1,9}$'
             AND _video_versions_payment_only(s.id,(o.metadata->>'delivery_version')::integer,s.version)))
       AND s.status=o.metadata->>'delivery_status'
       AND s.assigned_coach_id::text IS NOT DISTINCT FROM (o.metadata->>'delivery_coach')
       AND s.scheduled_for IS NOT DISTINCT FROM (o.metadata->>'delivery_start')::timestamptz;
     IF o.kind LIKE 'member\_%' OR o.kind='premier_video_reminder' THEN
       allowed:=allowed AND a.id=s.account_id;
       -- Terminal notices must still explain a cancellation after access loss.
       IF s.status IN ('requested','scheduled','live') THEN
         allowed:=allowed AND (_dispatcher_member_access(a.id,true) OR _dispatcher_admin(a.id)
           OR (s.appointment_type='one_off_150' AND (s.payment_status='paid'
             -- She books a one-off before paying; the coach's new time or
             -- request for an updated plan must still reach her.
             OR (s.payment_status='pending_payment'
                 AND o.kind IN ('member_video_counteroffer','member_plan_update_requested')))));
       END IF;
     ELSE
       allowed:=allowed AND is_video_staff(a.id) AND (o.kind='admin_video_request' OR a.id=s.assigned_coach_id);
     END IF;
     IF o.kind IN ('premier_video_reminder','coach_video_reminder') THEN allowed:=allowed AND s.status='scheduled'; END IF;
     IF o.kind='member_video_live' THEN allowed:=allowed AND s.status='live'; END IF;
     IF o.kind='member_plan_update_requested' THEN
       allowed:=allowed AND s.booking_purpose='plan_review' AND s.status IN ('requested','scheduled')
         AND s.update_requested_at IS NOT NULL;
     END IF;
   ELSE
     -- Unknown producer is an operational error, not a permanent denial.
     RAISE EXCEPTION 'unsupported_push_kind: %',o.kind;
   END IF;
 END CASE;
 IF NOT coalesce(allowed,false) OR (deadline IS NOT NULL AND deadline<=now()) THEN RETURN NULL; END IF;
 IF o.kind IN ('practice_incoming','invitation_window','group_live','premier_video_reminder','coach_video_reminder','member_video_live','member_video_scheduled') AND deadline IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('push_token',a.push_token,'expires_at',deadline,'ttl',
   CASE WHEN deadline IS NOT NULL THEN greatest(0,floor(extract(epoch FROM deadline-now()))::integer) ELSE ttl END);
END $$;

REVOKE ALL ON FUNCTION public.dispatcher_outbox_delivery(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatcher_outbox_delivery(uuid,uuid) TO service_role;

-- ── 2 + 3. Send windows ──────────────────────────────────────────────────────
-- The returned expires_at is when the device should stop showing the push
-- (never after the occurrence deadline the reservation is keyed on).
CREATE OR REPLACE FUNCTION public.dispatcher_job_delivery(p_job text,p_account_id uuid,p_session_id uuid,p_expires_at timestamptz,p_now timestamptz DEFAULT now(),p_force boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE a accounts; allowed boolean:=false; local_now timestamp:=p_now AT TIME ZONE 'America/Los_Angeles'; deadline timestamptz; occurrence timestamp;
  show_until timestamptz:=p_expires_at; tz text; member_now timestamp;
BEGIN
 SELECT * INTO a FROM accounts WHERE id=p_account_id;
 IF NOT FOUND OR nullif(a.push_token,'') IS NULL OR p_expires_at IS NULL OR p_expires_at<=p_now THEN RETURN NULL; END IF;
 IF p_job IN ('session_reminder','family_call_30min') THEN
   deadline:=(local_now::date+time '19:00') AT TIME ZONE 'America/Los_Angeles';
   IF p_force THEN
     -- Authorized operator previews still resolve the next real occurrence.
     -- Consent, RSVP and source identity are never bypassed.
     occurrence:=(local_now::date + ((8-extract(isodow FROM local_now)::integer)%7))+time '19:00';
     IF occurrence<=local_now THEN occurrence:=occurrence+interval '7 days'; END IF;
     deadline:=occurrence AT TIME ZONE 'America/Los_Angeles';
   END IF;
   allowed:=(p_force OR extract(isodow FROM local_now)=1) AND p_expires_at=deadline AND p_session_id=family_squares_session_id()
     AND a.family_call_reminders AND (p_force OR p_now>=deadline-interval '1 hour');
   IF p_job='session_reminder' THEN
     allowed:=allowed AND EXISTS(SELECT 1 FROM session_rsvps WHERE account_id=a.id AND session_id=p_session_id AND status='going');
     -- "Starts in about an hour": sent 6:00–6:15 PM Pacific, shown until 6:30.
     IF NOT p_force THEN
       allowed:=allowed AND p_now<deadline-interval '45 minutes';
       show_until:=least(show_until,deadline-interval '30 minutes');
     END IF;
   ELSE
     allowed:=allowed AND (p_force OR p_now>=deadline-interval '30 minutes') AND NOT EXISTS(SELECT 1 FROM session_rsvps
       WHERE account_id=a.id AND session_id=p_session_id AND status IN ('going','declined'));
     -- "Starts in 30 minutes": sent 6:30–6:40 PM Pacific, shown until 6:45.
     IF NOT p_force THEN
       allowed:=allowed AND p_now<deadline-interval '20 minutes';
       show_until:=least(show_until,deadline-interval '15 minutes');
     END IF;
   END IF;
 ELSIF p_job='winback' THEN
   allowed:=a.daily_push_opt_in AND a.created_at<p_now-interval '5 days'
     AND (a.last_winback_at IS NULL OR a.last_winback_at<p_now-interval '7 days')
     AND NOT EXISTS(SELECT 1 FROM checkins c WHERE c.account_id=a.id AND c.created_at>p_now-interval '5 days');
   IF coalesce(allowed,false) THEN
     -- 9 AM–8 PM in her own time zone; never shown after 8:30 PM.
     tz:=_invitation_valid_tz(a.timezone);
     member_now:=p_now AT TIME ZONE tz;
     allowed:=member_now::time>=time '09:00' AND member_now::time<time '20:00';
     show_until:=least(show_until,(member_now::date+time '20:30') AT TIME ZONE tz);
   END IF;
 END IF;
 IF NOT coalesce(allowed,false) OR show_until<=p_now THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('push_token',a.push_token,'expires_at',show_until,
   'ttl',greatest(0,floor(extract(epoch FROM show_until-p_now))::integer));
END $$;

REVOKE ALL ON FUNCTION public.dispatcher_job_delivery(text,uuid,uuid,timestamptz,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatcher_job_delivery(text,uuid,uuid,timestamptz,timestamptz,boolean) TO service_role;

-- A new winback cycle starts its attempt count over (the 'cooldown'
-- reservation row is reused for every cycle).
CREATE OR REPLACE FUNCTION public.claim_push_recipient(p_kind text,p_event_key text,p_account_id uuid,p_expires_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE token uuid:=gen_random_uuid(); claimed uuid;
BEGIN
 IF p_expires_at IS NULL OR p_expires_at<=clock_timestamp() THEN RETURN NULL; END IF;
 INSERT INTO push_recipient_deliveries AS d(kind,event_key,account_id,expires_at,processing_token,processing_at,attempt_count)
 VALUES(p_kind,p_event_key,p_account_id,p_expires_at,token,clock_timestamp(),1)
 ON CONFLICT(kind,event_key,account_id) DO UPDATE SET
   processing_token=token,processing_at=clock_timestamp(),
   attempt_count=CASE WHEN p_kind='winback' AND (d.sent_at<=clock_timestamp()-interval '7 days' OR d.expires_at<=clock_timestamp()) THEN 1 ELSE d.attempt_count+1 END,
   expires_at=CASE WHEN p_kind='winback' AND (d.sent_at<=clock_timestamp()-interval '7 days' OR d.expires_at<=clock_timestamp()) THEN p_expires_at ELSE least(d.expires_at,p_expires_at) END,
   sent_at=NULL
 WHERE (d.processing_token IS NULL OR d.processing_at<=clock_timestamp()-interval '5 minutes')
   AND ((d.sent_at IS NULL AND (d.expires_at>clock_timestamp() OR p_kind='winback'))
     OR (p_kind='winback' AND d.sent_at<=clock_timestamp()-interval '7 days'))
 RETURNING processing_token INTO claimed;
 RETURN claimed;
END $$;

REVOKE ALL ON FUNCTION public.claim_push_recipient(text,text,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_recipient(text,text,uuid,timestamptz) TO service_role;

-- The provider will never accept this recipient (DeviceNotRegistered): end
-- the reservation now instead of leaving it pending for retries.
CREATE OR REPLACE FUNCTION public.abandon_push_recipient(p_kind text,p_event_key text,p_account_id uuid,p_processing_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE push_recipient_deliveries SET sent_at=NULL,processing_token=NULL,processing_at=NULL,
   expires_at=least(expires_at,now())
 WHERE kind=p_kind AND event_key=p_event_key AND account_id=p_account_id
   AND processing_token=p_processing_token AND sent_at IS NULL;
 RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.abandon_push_recipient(text,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.abandon_push_recipient(text,text,uuid,uuid) TO service_role;

-- Re-send uses the immutable deadline: the same occurrence, never a new one.
CREATE OR REPLACE FUNCTION public.claim_dispatcher_job(p_job text,p_account_id uuid,p_session_id uuid,p_expires_at timestamptz,p_force boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE delivery jsonb; token uuid; kind text; event_key text; original_deadline timestamptz; show_until timestamptz;
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
 show_until:=least(original_deadline,(delivery->>'expires_at')::timestamptz);
 RETURN delivery||jsonb_build_object('processing_token',token,'reservation_kind',kind,'event_key',event_key,
   'expires_at',show_until,'ttl',greatest(0,floor(extract(epoch FROM show_until-clock_timestamp()))::integer));
END $$;

REVOKE ALL ON FUNCTION public.claim_dispatcher_job(text,uuid,uuid,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_dispatcher_job(text,uuid,uuid,timestamptz,boolean) TO service_role;

-- Failed winback reservations that can be re-sent now (each still eligible,
-- inside her send window, ≤ 5 attempts this cycle).
CREATE OR REPLACE FUNCTION public.dispatcher_winback_retry_targets(p_after_account_id uuid DEFAULT NULL,p_as_of timestamptz DEFAULT now())
RETURNS TABLE(account_id uuid,first_name text,push_token text,locale text,session_id uuid,expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT a.id,a.first_name,a.push_token,a.locale,NULL::uuid,d.expires_at
 FROM push_recipient_deliveries d JOIN accounts a ON a.id=d.account_id
 WHERE d.kind='winback' AND d.event_key='cooldown' AND d.sent_at IS NULL
   AND d.expires_at>p_as_of AND d.attempt_count<5
   AND (d.processing_token IS NULL OR d.processing_at<p_as_of-interval '5 minutes')
   AND (p_after_account_id IS NULL OR a.id>p_after_account_id)
   AND dispatcher_job_delivery('winback',a.id,NULL,d.expires_at,p_as_of,false) IS NOT NULL
 ORDER BY a.id
 LIMIT 1000
$$;

REVOKE ALL ON FUNCTION public.dispatcher_winback_retry_targets(uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatcher_winback_retry_targets(uuid,timestamptz) TO service_role;

-- Which Monday-call jobs the sweep may (re-)run at p_now.
CREATE OR REPLACE FUNCTION public._family_call_jobs_due(p_now timestamptz)
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT array_remove(ARRAY[
    CASE WHEN extract(isodow FROM l.t)=1 AND l.t::time>=time '18:00' AND l.t::time<time '18:15' THEN 'session_reminder' END,
    CASE WHEN extract(isodow FROM l.t)=1 AND l.t::time>=time '18:30' AND l.t::time<time '18:40' THEN 'family_call_30min' END
  ], NULL)
  FROM (SELECT p_now AT TIME ZONE 'America/Los_Angeles' AS t) l
$$;

REVOKE ALL ON FUNCTION public._family_call_jobs_due(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public._family_call_jobs_due(timestamptz) TO service_role;

-- The client invokes family backup only once. Retry discovery from the durable
-- source, even when the first request failed before reserving any recipient.
-- Monday-call discovery re-runs only inside each reminder's send window
-- (reservations make re-runs idempotent); winback retries only the failed
-- reservations, and only when one is sendable now.
CREATE OR REPLACE FUNCTION public.retry_notification_deliveries() RETURNS void
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
 -- Preview reservations are deliberately never promoted into scheduled sends.
 FOREACH job IN ARRAY _family_call_jobs_due(now()) LOOP
   PERFORM net.http_post(url:='https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/send-engagement-push',
     headers:=headers,body:=jsonb_build_object('job',job,'force',false));
 END LOOP;
 IF EXISTS(SELECT 1 FROM dispatcher_winback_retry_targets(NULL,now())) THEN
   PERFORM net.http_post(url:='https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/send-engagement-push',
     headers:=headers,body:=jsonb_build_object('job','winback','force',false,'retry',true));
 END IF;
END $$;

REVOKE ALL ON FUNCTION public.retry_notification_deliveries() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retry_notification_deliveries() TO service_role;

-- ── 4. A confirmed device ────────────────────────────────────────────────────
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS push_token_seen_at timestamptz;

-- A token written any other way than by register_push_device (cleared as
-- dead, moved to another account, set directly) is not confirmed.
CREATE OR REPLACE FUNCTION public._accounts_push_token_seen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.push_token IS NULL
     OR (NEW.push_token IS DISTINCT FROM OLD.push_token
         AND NEW.push_token_seen_at IS NOT DISTINCT FROM OLD.push_token_seen_at) THEN
    NEW.push_token_seen_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._accounts_push_token_seen() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS accounts_push_token_seen ON public.accounts;
CREATE TRIGGER accounts_push_token_seen
  BEFORE UPDATE OF push_token, push_token_seen_at ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public._accounts_push_token_seen();

-- Called by the app on every launch (with notification permission).
CREATE OR REPLACE FUNCTION public.register_push_device(p_token text, p_locale text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_account_id uuid := public.my_account_id();
BEGIN
  IF v_account_id IS NULL THEN RETURN false; END IF;
  IF p_token IS NULL OR length(p_token) NOT BETWEEN 20 AND 512
     OR p_token !~ '^Expo(nent)?PushToken[[][^]]+[]]$' THEN
    RAISE EXCEPTION 'invalid_push_token' USING ERRCODE = '22023';
  END IF;

  UPDATE public.accounts SET push_token = NULL
  WHERE push_token = p_token AND id <> v_account_id;
  UPDATE public.accounts
  SET push_token = p_token,
      push_token_seen_at = now(),
      locale = CASE WHEN coalesce(p_locale, 'en') LIKE 'es%' THEN 'es' ELSE 'en' END
  WHERE id = v_account_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.register_push_device(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_push_device(text,text) TO authenticated;

-- The app will remind her by push for this week's call: a device confirmed in
-- the last 30 days and the call reminder on (the dispatcher's own condition;
-- it then reminds "going" and not-yet-answered members, and leaves "declined"
-- alone).
CREATE OR REPLACE FUNCTION public._app_reminds_family_call(p_push_token text, p_seen_at timestamptz, p_reminders boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT nullif(btrim(coalesce(p_push_token, '')), '') IS NOT NULL
     AND p_seen_at IS NOT NULL
     AND p_seen_at > now() - interval '30 days'
     AND coalesce(p_reminders, false)
$$;

REVOKE ALL ON FUNCTION public._app_reminds_family_call(text, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._app_reminds_family_call(text, timestamptz, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.service_family_squares_attendees(p_since timestamptz)
RETURNS TABLE(email text, name text, rsvp text, questions text[], app_reminders boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session uuid := public.family_squares_session_id();
BEGIN
  IF p_since IS NULL OR NOT isfinite(p_since) THEN
    RAISE EXCEPTION 'invalid_since' USING ERRCODE = '22023';
  END IF;
  IF v_session IS NULL THEN
    RAISE EXCEPTION 'no_family_squares_session' USING ERRCODE = 'P0002';
  END IF;

  RETURN QUERY
  WITH rsvp AS (
    -- session_rsvps.account_id is accounts.id (foreign key). Matching a row
    -- written with the auth user id as well costs nothing and loses nobody.
    SELECT DISTINCT ON (a.id) a.id AS account_id, sr.status
    FROM public.session_rsvps sr
    JOIN public.accounts a ON a.id = sr.account_id OR a.user_id = sr.account_id
    WHERE sr.session_id = v_session
      AND sr.status IN ('going', 'declined')
      AND sr.created_at > p_since
    ORDER BY a.id, sr.created_at DESC
  ),
  asked AS (
    -- The newest five questions per person, oldest first (newest last).
    SELECT q.account_id, array_agg(q.text ORDER BY q.created_at, q.id) AS questions
    FROM (
      SELECT sq.account_id, sq.id, sq.created_at,
             left(btrim(sq.question, E' \t\r\n'), 500) AS text,
             row_number() OVER (PARTITION BY sq.account_id ORDER BY sq.created_at DESC, sq.id DESC) AS n
      FROM public.session_questions sq
      WHERE sq.session_id = v_session
        AND sq.created_at > p_since
        AND btrim(sq.question, E' \t\r\n') <> ''
    ) q
    WHERE q.n <= 5
    GROUP BY q.account_id
  ),
  people AS (
    SELECT r.account_id FROM rsvp r
    UNION
    SELECT k.account_id FROM asked k
  )
  SELECT lower(btrim(u.email::text)),
         coalesce(left(nullif(btrim(a.first_name), ''), 100), ''),  -- empty: the website greets them as "Friend"
         r.status,
         coalesce(k.questions, ARRAY[]::text[]),
         public._app_reminds_family_call(a.push_token, a.push_token_seen_at, a.family_call_reminders)
  FROM people p
  JOIN public.accounts a ON a.id = p.account_id
  JOIN auth.users u ON u.id = a.user_id
  LEFT JOIN rsvp r ON r.account_id = a.id
  LEFT JOIN asked k ON k.account_id = a.id
  WHERE u.email_confirmed_at IS NOT NULL
    AND u.deleted_at IS NULL
    AND nullif(btrim(u.email::text), '') IS NOT NULL
  ORDER BY 1
  -- One past the website's 2000 cap, so the caller can refuse a truncated set.
  LIMIT 2001;
END;
$$;

REVOKE ALL ON FUNCTION public.service_family_squares_attendees(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_family_squares_attendees(timestamptz) TO service_role;

-- p_since is kept for the website contract; the answer no longer depends on
-- an RSVP (an RSVP alone never made the app send a reminder).
CREATE OR REPLACE FUNCTION public.service_family_squares_push_reachable(p_emails text[], p_since timestamptz)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result text[];
BEGIN
  IF p_since IS NULL OR NOT isfinite(p_since) THEN
    RAISE EXCEPTION 'invalid_since' USING ERRCODE = '22023';
  END IF;
  IF coalesce(cardinality(p_emails), 0) > 1000 THEN
    RAISE EXCEPTION 'too_many_emails' USING ERRCODE = '22023';
  END IF;

  WITH wanted AS (
    SELECT DISTINCT lower(btrim(x)) AS email
    FROM unnest(coalesce(p_emails, ARRAY[]::text[])) AS x
    WHERE nullif(btrim(x), '') IS NOT NULL
  )
  SELECT coalesce(array_agg(DISTINCT w.email ORDER BY w.email), ARRAY[]::text[])
    INTO v_result
  FROM wanted w
  JOIN auth.users u ON lower(btrim(u.email::text)) = w.email
  JOIN public.accounts a ON a.user_id = u.id
  WHERE u.email_confirmed_at IS NOT NULL
    AND u.deleted_at IS NULL
    AND public._app_reminds_family_call(a.push_token, a.push_token_seen_at, a.family_call_reminders);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.service_family_squares_push_reachable(text[], timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_family_squares_push_reachable(text[], timestamptz) TO service_role;
