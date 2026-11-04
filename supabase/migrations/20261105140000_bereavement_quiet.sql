-- A bereaved member can pause every reminder and note, and turn them back on
-- (loved_ones.bereavement_quiet, her own record only, via
-- set_bereavement_quiet()). Quiet applies only while died_at is set; undoing
-- "They died" clears it. Paused: the Monday call reminders and 30-minute
-- invite, the Tuesday note, winback, group-live and community notes (here),
-- plus the morning note, daily nudge, 15-minute reminder and La Sobremesa
-- reminder (their Edge Functions read the same flag). Kept: chat messages,
-- coaching/video session notices she arranged, admin and coach alerts.
-- Old builds never send the flag, so for them nothing changes.

ALTER TABLE public.loved_ones ADD COLUMN IF NOT EXISTS bereavement_quiet boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public._account_reminders_paused(p_account uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.loved_ones
    WHERE account_id = p_account AND died_at IS NOT NULL AND bereavement_quiet);
$$;
REVOKE EXECUTE ON FUNCTION public._account_reminders_paused(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_bereavement_quiet(p_quiet boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := public.my_account_id();
  v_quiet boolean;
BEGIN
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.loved_ones SET bereavement_quiet = coalesce(p_quiet, false), updated_at = now()
  WHERE account_id = v_account AND died_at IS NOT NULL
  RETURNING bereavement_quiet INTO v_quiet;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_bereaved' USING ERRCODE = '22023';
  END IF;
  RETURN v_quiet;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_bereavement_quiet(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_bereavement_quiet(boolean) TO authenticated;

-- Undo also lifts the quiet (otherwise unchanged from 20261105120000).
CREATE OR REPLACE FUNCTION public.clear_loved_one_died()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := public.my_account_id();
BEGIN
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  UPDATE public.loved_ones SET died_at = NULL, bereavement_contact = false, bereavement_quiet = false, updated_at = now()
  WHERE account_id = v_account;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clear_loved_one_died() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_loved_one_died() TO authenticated;

-- Delivery rules: the reminder pause (otherwise unchanged from
-- 20261105120000_bereavement).
CREATE OR REPLACE FUNCTION public.dispatcher_outbox_delivery(p_outbox_id uuid, p_processing_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE o push_outbox; a accounts; s video_sessions; deadline timestamptz; allowed boolean:=false; ttl integer;
  tz text; member_now timestamp;
BEGIN
 SELECT * INTO o FROM push_outbox WHERE id=p_outbox_id AND processing_token=p_processing_token
 AND processing_at>now()-interval '5 minutes' AND sent_at IS NULL AND failed_at IS NULL AND scheduled_for<=now();
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO a FROM accounts WHERE id=o.account_id;
 IF NOT FOUND OR nullif(a.push_token,'') IS NULL THEN RETURN NULL; END IF;
 deadline:=o.expires_at;
 -- After her loved one died, nothing about their recovery or a conversation
 -- with them reaches her (receptivity windows, incoming-call practice).
 IF o.kind IN ('invitation_window','practice_incoming') AND _account_bereaved(a.id) THEN RETURN NULL; END IF;
 -- She paused reminders and notes while she grieves: every engagement push
 -- waits. Messages from people and sessions she arranged still arrive.
 IF o.kind IN ('family_call_followup','group_live','community_support') AND _account_reminders_paused(a.id) THEN RETURN NULL; END IF;
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
     AND t.kind='oncall' AND t.status='active' AND t.account_id<>a.id AND t.last_member_message_at IS NOT NULL
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
 WHEN 'family_call_followup' THEN
   -- The Tuesday note after The Family Squares: only while she still wants
   -- Monday call reminders, and only in her daytime (8 AM-9 PM).
   tz:=CASE WHEN nullif(btrim(coalesce(a.timezone,'')),'') IS NULL THEN 'America/Los_Angeles' ELSE _invitation_valid_tz(a.timezone) END;
   member_now:=now() AT TIME ZONE tz;
   deadline:=least(coalesce(deadline,'infinity'::timestamptz),(member_now::date+time '21:00') AT TIME ZONE tz);
   allowed:=coalesce(a.family_call_reminders,false) AND coalesce(a.locale,'en') NOT LIKE 'es%'
     AND member_now::time>=time '08:00' AND member_now::time<time '21:00';
 WHEN 'admin_session_question' THEN
   -- A question for Monday's call that reads like an emergency.
   allowed:=_dispatcher_admin(a.id) AND EXISTS(SELECT 1 FROM session_questions q
     WHERE q.id::text=o.metadata->>'question_id' AND q.crisis_tier IS NOT NULL);
 WHEN 'admin_bereavement' THEN
   -- A member told us her loved one died and asked for someone to reach out;
   -- not after she undid it.
   allowed:=_dispatcher_admin(a.id) AND EXISTS(SELECT 1 FROM loved_ones l
     WHERE l.account_id::text=o.metadata->>'member_account_id' AND l.died_at IS NOT NULL AND l.bereavement_contact);
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
END $function$;

-- The pause for scheduled jobs (otherwise unchanged from
-- 20261104100000_monday_call_followup).
CREATE OR REPLACE FUNCTION public.dispatcher_job_delivery(p_job text, p_account_id uuid, p_session_id uuid, p_expires_at timestamp with time zone, p_now timestamp with time zone DEFAULT now(), p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a accounts; allowed boolean:=false; local_now timestamp:=p_now AT TIME ZONE 'America/Los_Angeles'; deadline timestamptz; occurrence timestamp;
  show_until timestamptz:=p_expires_at; tz text; member_now timestamp;
BEGIN
 SELECT * INTO a FROM accounts WHERE id=p_account_id;
 IF NOT FOUND OR nullif(a.push_token,'') IS NULL OR p_expires_at IS NULL OR p_expires_at<=p_now THEN RETURN NULL; END IF;
 -- Monday call reminders, the 30-minute invite and winback all pause while a
 -- bereaved member has asked for quiet.
 IF _account_reminders_paused(a.id) THEN RETURN NULL; END IF;
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
     AND a.family_call_reminders AND (p_force OR p_now>=deadline-interval '1 hour')
     -- Spanish members are invited to La Sobremesa (8 PM), not The Family Squares (7 PM).
     AND coalesce(a.locale,'en') NOT LIKE 'es%';
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
     -- An invitation, not a reminder she asked for: never at night where she is
     -- (6:30 PM Pacific is 2:30 AM in London).
     IF NOT p_force AND coalesce(allowed,false) THEN
       member_now:=p_now AT TIME ZONE _invitation_valid_tz(a.timezone);
       allowed:=member_now::time>=time '08:00' AND member_now::time<time '22:00';
     END IF;
     -- "Starts in 30 minutes": sent 6:30–6:40 PM Pacific, shown until 6:45.
     IF NOT p_force THEN
       allowed:=allowed AND p_now<deadline-interval '20 minutes';
       show_until:=least(show_until,deadline-interval '15 minutes');
     END IF;
   END IF;
 ELSIF p_job='winback' THEN
   allowed:=a.daily_push_opt_in AND a.created_at<p_now-interval '5 days'
     AND (a.last_winback_at IS NULL OR a.last_winback_at<p_now-interval '7 days')
     AND NOT EXISTS(SELECT 1 FROM checkins c WHERE c.account_id=a.id AND c.created_at>p_now-interval '5 days')
     -- She was just at (or saved a seat for) Monday's call and has Tuesday's note.
     AND NOT EXISTS(SELECT 1 FROM push_outbox o WHERE o.account_id=a.id AND o.kind='family_call_followup'
       AND o.created_at>p_now-interval '36 hours');
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
END $function$;
