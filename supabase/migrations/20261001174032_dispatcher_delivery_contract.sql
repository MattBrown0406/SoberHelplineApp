-- Fanout keys include the recipient; otherwise only the first staff member
-- received each requested event. Existing rows remain immutable.
CREATE OR REPLACE FUNCTION public._video_push(p_account uuid, p_kind text, p_title text, p_body text, p_session uuid, p_version integer, p_event text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_title text := p_title;
  v_body text := p_body;
  v_session video_sessions;
  v_spanish boolean := false;
  v_neutral boolean := false;
  v_copy_title text;
  v_copy_body text;
BEGIN
  SELECT * INTO v_session FROM video_sessions WHERE id = p_session;
  IF FOUND THEN
    v_neutral := v_session.appointment_type = 'one_off_150' OR v_session.member_tier_at_booking = 'organization';
  END IF;

  IF p_kind LIKE 'member\_%' THEN
    -- Members get their own language; callers' English text is the fallback
    -- for any kind without localized copy.
    SELECT COALESCE(a.locale, 'en') LIKE 'es%' INTO v_spanish FROM accounts a WHERE a.id = p_account;
    SELECT c.title, c.body INTO v_copy_title, v_copy_body
    FROM public._video_member_push_copy(p_kind, p_event, COALESCE(v_spanish, false), v_neutral,
      CASE WHEN p_kind = 'member_video_scheduled'
        THEN public._video_push_when(v_session.scheduled_for, v_session.requested_timezone, COALESCE(v_spanish, false))
      END) c;
    IF v_copy_title IS NOT NULL THEN
      v_title := v_copy_title;
      v_body := v_copy_body;
    END IF;
  ELSIF v_neutral THEN
    -- Staff copy stays English; a one-off review is not a Premier session.
    v_title := replace(v_title, 'Premier ', '');
    v_body := replace(v_body, 'Premier ', '');
  END IF;

  INSERT INTO push_outbox(account_id, kind, title, body, metadata, idempotency_key)
  VALUES(p_account, p_kind, v_title, v_body,
    jsonb_build_object('kind', p_kind, 'deep_link', 'soberhelpline://premier-video/' || p_session::text, 'screen', 'premier-video', 'session_id', p_session, 'event', p_event),
    'video:' || p_session::text || ':' || p_version::text || ':' || p_event || ':' || p_account::text)
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
END $function$;

-- All dispatcher decisions are service-only and identity/claim bound. These
-- snapshots cannot recall a provider request already in flight.
CREATE FUNCTION public._dispatcher_admin(p_account uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM accounts a JOIN auth.users u ON u.id=a.user_id
 WHERE a.id=p_account AND lower(coalesce(u.email,''))=ANY(admin_email_list()))
$$;
CREATE FUNCTION public._dispatcher_member_access(p_account uuid, p_premium boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM accounts a WHERE a.id=p_account AND (
 (a.type='attached' AND EXISTS(SELECT 1 FROM orgs o WHERE o.id=a.org_id AND o.status='active'))
 OR EXISTS(SELECT 1 FROM entitlements e WHERE e.account_id=a.id
 AND (e.tier IN ('premium','org') OR (NOT p_premium AND e.tier='essential'))
 AND (e.expires_at IS NULL OR e.expires_at>now()))))
$$;

-- Capture event identity at INSERT, never from a retry's scheduled_for.
CREATE FUNCTION public._dispatcher_outbox_snapshot() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s video_sessions; h group_hosts;
BEGIN
 IF TG_OP='UPDATE' THEN
   NEW.expires_at:=OLD.expires_at;
   -- Event and recipient identities cannot be edited under a worker's claim.
   IF (NEW.account_id,NEW.kind,NEW.metadata,NEW.title,NEW.body,NEW.idempotency_key)
      IS DISTINCT FROM (OLD.account_id,OLD.kind,OLD.metadata,OLD.title,OLD.body,OLD.idempotency_key) THEN
     RAISE EXCEPTION 'push_identity_immutable';
   END IF;
   RETURN NEW;
 END IF;
 IF NEW.kind='practice_incoming' THEN
   NEW.expires_at:=least((NEW.metadata->>'expires_at')::timestamptz, NEW.created_at+interval '4 hours');
 ELSIF NEW.kind='group_live' THEN
   SELECT * INTO h FROM group_hosts WHERE room_name=NEW.metadata->>'room_name'
     AND live_event_id::text=NEW.metadata->>'event_id';
   NEW.expires_at:=h.live_started_at+interval '3 hours';
 ELSIF NEW.kind IN ('admin_video_request','member_video_scheduled','member_video_counteroffer',
   'member_video_live','member_video_cancelled','member_video_completed','member_video_no_show',
   'coach_video_accepted','coach_video_cancelled','coach_video_reschedule','premier_video_reminder','coach_video_reminder','member_plan_update_requested') THEN
   SELECT * INTO s FROM video_sessions WHERE id::text=NEW.metadata->>'session_id';
   NEW.metadata:=NEW.metadata||jsonb_build_object('delivery_version',s.version,'delivery_status',s.status,
      'delivery_coach',s.assigned_coach_id,'delivery_start',s.scheduled_for);
   NEW.expires_at:=CASE WHEN NEW.kind IN ('premier_video_reminder','coach_video_reminder','member_video_scheduled')
     THEN s.scheduled_for WHEN NEW.kind='member_video_live' THEN s.scheduled_for+make_interval(mins=>s.duration_minutes)+interval '30 minutes'
     ELSE NULL END;
 END IF;
 RETURN NEW;
END $$;
-- Backfill only from original event evidence. Legacy video versions are encoded
-- in the idempotency key, not inferred from today's session version.
UPDATE push_outbox o SET expires_at=least(e.expires_at,o.created_at+interval '4 hours')
FROM practice_push_events e WHERE o.kind='practice_incoming' AND e.event_id::text=o.metadata->>'event_id' AND e.account_id=o.account_id;
UPDATE push_outbox o SET expires_at=h.live_started_at+interval '3 hours'
FROM group_hosts h WHERE o.kind='group_live' AND h.room_name=o.metadata->>'room_name' AND h.live_event_id::text=o.metadata->>'event_id';
UPDATE push_outbox o SET metadata=o.metadata||jsonb_build_object('delivery_version',split_part(o.idempotency_key,':',3),
 'delivery_status',s.status,'delivery_coach',s.assigned_coach_id,'delivery_start',s.scheduled_for),
 expires_at=CASE WHEN o.kind IN ('premier_video_reminder','coach_video_reminder','member_video_scheduled') THEN s.scheduled_for
 WHEN o.kind='member_video_live' THEN s.scheduled_for+make_interval(mins=>s.duration_minutes)+interval '30 minutes'
 ELSE NULL END
FROM video_sessions s WHERE s.id::text=o.metadata->>'session_id' AND o.idempotency_key LIKE 'video:%';
CREATE TRIGGER zz_dispatcher_outbox_snapshot BEFORE INSERT OR UPDATE ON public.push_outbox
FOR EACH ROW EXECUTE FUNCTION public._dispatcher_outbox_snapshot();

CREATE FUNCTION public._dispatcher_cancel_practice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE push_outbox SET failed_at=now(),last_error='practice_withdrawn',processing_at=NULL,processing_token=NULL
 WHERE account_id=NEW.account_id AND kind='practice_incoming' AND sent_at IS NULL AND failed_at IS NULL;
 RETURN NEW;
END $$;
UPDATE push_outbox o SET failed_at=now(),last_error='practice_withdrawn',processing_at=NULL,processing_token=NULL
WHERE o.kind='practice_incoming' AND o.sent_at IS NULL AND o.failed_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM practice_push_preferences p WHERE p.account_id=o.account_id AND p.enabled);
CREATE TRIGGER dispatcher_practice_withdrawal AFTER INSERT OR UPDATE ON public.practice_push_preferences
FOR EACH ROW WHEN (NOT NEW.enabled) EXECUTE FUNCTION public._dispatcher_cancel_practice();

CREATE FUNCTION public.dispatcher_outbox_delivery(p_outbox_id uuid,p_processing_token uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE o push_outbox; a accounts; s video_sessions; deadline timestamptz; allowed boolean:=false; ttl integer;
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
   allowed:=EXISTS(SELECT 1 FROM community_posts p WHERE p.id::text=o.metadata->>'post_id'
     AND p.account_id=a.id AND p.status='visible' AND EXISTS(SELECT 1 FROM community_supports c
       WHERE c.post_id=p.id AND c.supporter_account_id<>a.id));
 WHEN 'admin_community_report' THEN
   allowed:=_dispatcher_admin(a.id) AND EXISTS(SELECT 1 FROM community_posts p JOIN community_reports r ON r.post_id=p.id
     WHERE p.id::text=o.metadata->>'post_id' AND p.status<>'removed');
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
     allowed:=FOUND AND s.version::text=o.metadata->>'delivery_version'
       AND s.status=o.metadata->>'delivery_status'
       AND s.assigned_coach_id::text IS NOT DISTINCT FROM (o.metadata->>'delivery_coach')
       AND s.scheduled_for IS NOT DISTINCT FROM (o.metadata->>'delivery_start')::timestamptz;
     IF o.kind LIKE 'member\_%' OR o.kind='premier_video_reminder' THEN
       allowed:=allowed AND a.id=s.account_id;
       -- Terminal notices must still explain a cancellation after access loss.
       IF s.status IN ('requested','scheduled','live') THEN
         allowed:=allowed AND (_dispatcher_member_access(a.id,true) OR _dispatcher_admin(a.id)
           OR (s.appointment_type='one_off_150' AND s.payment_status='paid'));
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

-- Scheduled jobs resolve account identity as well as an absolute occurrence.
-- Family Squares is a free Monday 7pm Pacific call: do not invent a paywall.
CREATE FUNCTION public.dispatcher_job_delivery(p_job text,p_account_id uuid,p_session_id uuid,p_expires_at timestamptz,p_now timestamptz DEFAULT now(),p_force boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE a accounts; allowed boolean:=false; local_now timestamp:=p_now AT TIME ZONE 'America/Los_Angeles'; deadline timestamptz; occurrence timestamp;
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
   ELSE
     allowed:=allowed AND (p_force OR p_now>=deadline-interval '30 minutes') AND NOT EXISTS(SELECT 1 FROM session_rsvps
       WHERE account_id=a.id AND session_id=p_session_id AND status IN ('going','declined'));
   END IF;
 ELSIF p_job='winback' THEN
   allowed:=a.daily_push_opt_in AND a.created_at<p_now-interval '5 days'
     AND (a.last_winback_at IS NULL OR a.last_winback_at<p_now-interval '7 days')
     AND NOT EXISTS(SELECT 1 FROM checkins c WHERE c.account_id=a.id AND c.created_at>p_now-interval '5 days');
 END IF;
 IF NOT coalesce(allowed,false) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('push_token',a.push_token,'expires_at',p_expires_at,
   'ttl',greatest(0,floor(extract(epoch FROM p_expires_at-p_now))::integer));
END $$;
-- Stable account keyset, not OFFSET: successful winback acknowledgments remove
-- candidates while pages are being drained. Pin discovery time across pages so
-- a call occurrence / winback deadline cannot change underneath the cursor.
CREATE FUNCTION public.dispatcher_job_targets(p_job text,p_force boolean DEFAULT false,p_after_account_id uuid DEFAULT NULL,p_as_of timestamptz DEFAULT now()) RETURNS TABLE(account_id uuid,first_name text,push_token text,locale text,session_id uuid,expires_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT a.id,a.first_name,a.push_token,a.locale,x.sid,x.deadline FROM accounts a
 CROSS JOIN LATERAL (SELECT CASE WHEN p_job='winback' THEN NULL::uuid ELSE family_squares_session_id() END sid,
 CASE WHEN p_job='winback' THEN p_as_of+interval '24 hours'
 ELSE ((
   (p_as_of AT TIME ZONE 'America/Los_Angeles')::date
   + CASE WHEN p_force THEN
       ((8-extract(isodow FROM p_as_of AT TIME ZONE 'America/Los_Angeles')::integer)%7)
       + CASE WHEN extract(isodow FROM p_as_of AT TIME ZONE 'America/Los_Angeles')=1
           AND (p_as_of AT TIME ZONE 'America/Los_Angeles')::time>=time '19:00' THEN 7 ELSE 0 END
     ELSE 0 END
   + time '19:00') AT TIME ZONE 'America/Los_Angeles') END deadline) x
 WHERE (p_after_account_id IS NULL OR a.id>p_after_account_id)
 AND dispatcher_job_delivery(p_job,a.id,x.sid,x.deadline,p_as_of,p_force) IS NOT NULL
 ORDER BY a.id
 LIMIT 1000
$$;
REVOKE ALL ON FUNCTION public._dispatcher_admin(uuid),public._dispatcher_member_access(uuid,boolean),public._dispatcher_outbox_snapshot(),public._dispatcher_cancel_practice(),public.dispatcher_outbox_delivery(uuid,uuid),public.dispatcher_job_delivery(text,uuid,uuid,timestamptz,timestamptz,boolean),public.dispatcher_job_targets(text,boolean,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatcher_outbox_delivery(uuid,uuid),public.dispatcher_job_delivery(text,uuid,uuid,timestamptz,timestamptz,boolean),public.dispatcher_job_targets(text,boolean,uuid,timestamptz) TO service_role;
