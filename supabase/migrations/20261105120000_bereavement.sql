-- When a member's loved one dies (a quiet "They died" option in the app).
-- loved_ones.died_at marks it for her own account only, through
-- mark_loved_one_died(); clear_loved_one_died() undoes a mistaken tap.
-- From then on the pushes about the loved one stop (receptivity windows,
-- incoming-call practice; the morning boundaries note is skipped in
-- notify-daily-morning). Monday call reminders and notes keep following her
-- own call-reminder switch. With her permission, admins get one alert so
-- someone can reach out personally (Admin -> Families who lost someone).
-- Old builds never call these and keep working: the new columns are
-- nullable/defaulted and their loved-one upserts never name them.

ALTER TABLE public.loved_ones ADD COLUMN IF NOT EXISTS died_at timestamptz;
ALTER TABLE public.loved_ones ADD COLUMN IF NOT EXISTS bereavement_contact boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public._account_bereaved(p_account uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.loved_ones WHERE account_id = p_account AND died_at IS NOT NULL);
$$;
REVOKE EXECUTE ON FUNCTION public._account_bereaved(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_loved_one_died(p_contact boolean DEFAULT false)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := public.my_account_id();
  v_died timestamptz;
BEGIN
  IF v_account IS NULL THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  INSERT INTO public.loved_ones (account_id, died_at, bereavement_contact, updated_at)
  VALUES (v_account, now(), coalesce(p_contact, false), now())
  ON CONFLICT (account_id) DO UPDATE
    SET died_at = coalesce(public.loved_ones.died_at, now()),
        bereavement_contact = public.loved_ones.bereavement_contact OR coalesce(p_contact, false),
        updated_at = now()
  RETURNING died_at INTO v_died;
  IF coalesce(p_contact, false) THEN
    INSERT INTO public.push_outbox (account_id, kind, title, body, metadata, idempotency_key, expires_at)
    SELECT a.id, 'admin_bereavement', 'A family lost their loved one',
      'A member told us their loved one died and would welcome someone reaching out (Admin → Families who lost someone).',
      jsonb_build_object('kind', 'admin_bereavement', 'member_account_id', v_account),
      'bereavement:' || a.id || ':' || v_account,
      now() + interval '7 days'
    FROM public.accounts a
    JOIN auth.users u ON u.id = a.user_id
    WHERE lower(coalesce(u.email, '')) = ANY (public.admin_email_list())
      AND a.push_token IS NOT NULL
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  END IF;
  RETURN v_died;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.mark_loved_one_died(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_loved_one_died(boolean) TO authenticated;

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
  UPDATE public.loved_ones SET died_at = NULL, bereavement_contact = false, updated_at = now()
  WHERE account_id = v_account;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.clear_loved_one_died() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_loved_one_died() TO authenticated;

-- Who asked for someone to reach out, newest first (last 180 days).
CREATE OR REPLACE FUNCTION public.admin_bereavement_contacts()
RETURNS TABLE(account_id uuid, first_name text, last_name text, email text, reported_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  SELECT a.id, a.first_name, a.last_name, u.email::text, l.died_at
  FROM public.loved_ones l
  JOIN public.accounts a ON a.id = l.account_id
  LEFT JOIN auth.users u ON u.id = a.user_id
  WHERE l.died_at IS NOT NULL AND l.bereavement_contact AND l.died_at > now() - interval '180 days'
  ORDER BY l.died_at DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_bereavement_contacts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_bereavement_contacts() TO authenticated;

-- Delivery rules: the bereavement suppression and the admin alert (otherwise
-- unchanged from 20261104100000_monday_call_followup).
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
