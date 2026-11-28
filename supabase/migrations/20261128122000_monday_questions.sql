BEGIN;
ALTER TABLE public.session_questions ADD COLUMN answered_at timestamptz;
ALTER TABLE public.session_questions ADD COLUMN answered_by uuid REFERENCES public.accounts(id) ON DELETE SET NULL;
ALTER TABLE public.session_questions ADD COLUMN read_anonymously boolean NOT NULL DEFAULT false;
-- Legacy clients do not make an anonymity request; the new form sends its preference explicitly.
ALTER TABLE public.session_questions ADD COLUMN meeting_date date;

CREATE FUNCTION public._question_defaults() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE local_now timestamp := now() AT TIME ZONE 'America/Los_Angeles'; d date;
BEGIN
 NEW.answered_at:=NULL; NEW.answered_by:=NULL;
 IF auth.role()='authenticated' THEN NEW.created_at:=now(); END IF;
 IF NEW.session_id=public.family_squares_session_id() THEN
   d:=date_trunc('week',local_now)::date;
   IF local_now>=d+time '20:00' THEN d:=d+7; END IF;
   NEW.meeting_date:=d;
 ELSE NEW.meeting_date:=NULL; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._question_defaults() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER question_defaults BEFORE INSERT ON public.session_questions FOR EACH ROW EXECUTE FUNCTION public._question_defaults();

CREATE FUNCTION public.submit_session_question(p_id uuid,p_account uuid,p_session uuid,p_question text,p_read_anonymously boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE q session_questions;
BEGIN
 IF my_account_id() IS NULL OR my_account_id() IS DISTINCT FROM p_account THEN RAISE EXCEPTION 'not authorized'; END IF;
 IF p_id IS NULL OR p_question IS NULL OR length(btrim(p_question)) NOT BETWEEN 1 AND 500 OR p_read_anonymously IS NULL THEN RAISE EXCEPTION 'invalid question'; END IF;
 -- Serialize retries for the same request without notifying the host twice.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 SELECT * INTO q FROM session_questions WHERE id=p_id;
 IF FOUND THEN
   IF q.account_id<>p_account OR q.session_id<>p_session OR q.question<>btrim(p_question) OR q.read_anonymously<>p_read_anonymously THEN RAISE EXCEPTION 'request already used'; END IF;
 ELSE
   INSERT INTO session_questions(id,account_id,session_id,question,read_anonymously)
   VALUES(p_id,p_account,p_session,btrim(p_question),p_read_anonymously) RETURNING * INTO q;
 END IF;
 RETURN jsonb_build_object('id',q.id,'crisis_tier',q.crisis_tier,'meeting_date',q.meeting_date);
END $$;
REVOKE ALL ON FUNCTION public.submit_session_question(uuid,uuid,uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_session_question(uuid,uuid,uuid,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public._session_question_alert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO push_outbox(account_id,kind,title,body,metadata,idempotency_key,expires_at)
 SELECT a.id,'admin_session_question',
   CASE WHEN NEW.crisis_tier IS NOT NULL THEN 'A question needs urgent review' ELSE 'New meeting question' END,
   'Open Admin to review the question and track its answer.',
   jsonb_build_object('kind','admin_session_question','question_id',NEW.id),
   'session-question:'||a.id||':'||NEW.id,now()+interval '7 days'
 FROM accounts a WHERE public._dispatcher_admin(a.id) AND nullif(a.push_token,'') IS NOT NULL
 ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
 RETURN NULL;
END $$;

DROP FUNCTION public.admin_get_session_questions(text);
CREATE FUNCTION public.admin_get_session_questions(p_session_title text DEFAULT NULL)
RETURNS TABLE(id uuid,first_name text,last_name text,question text,submitted_at timestamptz,crisis_tier text,session_title text,
 answered_at timestamptz,read_anonymously boolean,meeting_date date)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT is_admin_jwt() THEN RAISE EXCEPTION 'not authorized'; END IF;
 RETURN QUERY SELECT q.id,a.first_name,a.last_name,q.question,q.created_at,q.crisis_tier,s.title,q.answered_at,q.read_anonymously,q.meeting_date
 FROM session_questions q JOIN accounts a ON a.id=q.account_id JOIN sessions s ON s.id=q.session_id
 WHERE p_session_title IS NULL OR s.title=p_session_title
 ORDER BY (q.answered_at IS NOT NULL), (q.crisis_tier IS NULL),q.created_at;
END $$;
REVOKE ALL ON FUNCTION public.admin_get_session_questions(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_get_session_questions(text) TO authenticated;

CREATE FUNCTION public.admin_answer_session_question(p_id uuid,p_answered boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT is_admin_jwt() THEN RAISE EXCEPTION 'not authorized'; END IF;
 IF p_answered IS NULL THEN RAISE EXCEPTION 'invalid status'; END IF;
 UPDATE session_questions SET answered_at=CASE WHEN p_answered THEN coalesce(answered_at,now()) END,
 answered_by=CASE WHEN p_answered THEN coalesce(answered_by,my_account_id()) END WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'question not found'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.admin_answer_session_question(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.admin_answer_session_question(uuid,boolean) TO authenticated;

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
   -- Every submitted question remains actionable until explicitly answered.
   allowed:=_dispatcher_admin(a.id) AND EXISTS(SELECT 1 FROM session_questions q
     WHERE q.id::text=o.metadata->>'question_id' AND q.answered_at IS NULL);
 WHEN 'admin_bereavement' THEN
   -- A member told us her loved one died and asked for someone to reach out;
   -- not after she undid it.
   allowed:=_dispatcher_admin(a.id) AND EXISTS(SELECT 1 FROM loved_ones l
     WHERE l.account_id::text=o.metadata->>'member_account_id' AND l.died_at IS NOT NULL AND l.bereavement_contact);
 WHEN 'admin_reach_out' THEN
   -- A member asked Matt to reach out after a hard check-in on Today (4.4);
   -- not once the request is marked done in Admin.
   allowed:=is_video_owner(a.id) AND EXISTS(SELECT 1 FROM reach_out_requests r
     WHERE r.id::text=o.metadata->>'request_id' AND r.handled_at IS NULL);
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
             CASE WHEN sq.read_anonymously THEN '[Read without my name] ' ELSE '' END || left(btrim(sq.question, E' \t\r\n'), 500) AS text,
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
         public._app_reminds_family_call(a.push_token, a.push_token_seen_at, a.family_call_reminders, a.locale)
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


COMMIT;
