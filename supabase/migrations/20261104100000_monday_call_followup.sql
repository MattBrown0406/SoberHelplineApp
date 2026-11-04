-- Build the week around the Monday call (The Family Squares).
--
-- 1. "This week's one thing": an admin can write one line for the week's call
--    (admin_set_family_call_takeaway); members read the current one on Today
--    (family_call_takeaway()).
-- 2. Tuesday morning, in her own time zone, a note to everyone who saved a
--    seat for or joined Monday's call: this week's one thing, and next
--    Monday's seat is one tap away. Enqueued at 1 AM Pacific, an hour before
--    the 2 AM reset clears last night's RSVPs.
-- 3. Questions for the call are read with the community crisis screen. One
--    that mentions suicide, an overdose, self-harm or violence alerts an admin
--    now instead of waiting for the call (the app shows her 988/911).
-- 4. accounts.push_app_contract: which app builds understand the new pushes
--    (4.2 (3)+ register with 1). Older builds keep the wording they can act
--    on: the hour-before reminder without "send a question", and a Tuesday
--    note that does not point at Today's new card.
-- 5. Winback ("We're still here") skips members who just got the Tuesday note.

-- 1 = opens the question sheet from the hour-before reminder and shows this
-- week's one thing on Today. NULL = an older build (or no device).
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS push_app_contract smallint;

CREATE OR REPLACE FUNCTION public.register_push_device(p_token text, p_locale text, p_app_contract integer)
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
      locale = CASE WHEN coalesce(p_locale, 'en') LIKE 'es%' THEN 'es' ELSE 'en' END,
      push_app_contract = CASE WHEN p_app_contract BETWEEN 1 AND 100 THEN p_app_contract END
  WHERE id = v_account_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.register_push_device(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_push_device(text, text, integer) TO authenticated;

-- Older builds (two arguments): the device's token now belongs to a build
-- that knows none of the new pushes.
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
      locale = CASE WHEN coalesce(p_locale, 'en') LIKE 'es%' THEN 'es' ELSE 'en' END,
      push_app_contract = NULL
  WHERE id = v_account_id;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.register_push_device(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_push_device(text, text) TO authenticated;

-- Monday (Pacific date) of the most recent Family Squares call that has started.
CREATE OR REPLACE FUNCTION public._family_squares_latest_meeting_date(p_now timestamptz DEFAULT now())
RETURNS date
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN l.t >= (l.monday + time '19:00') THEN l.monday ELSE l.monday - 7 END
  FROM (
    SELECT x.t, x.t::date - (extract(isodow FROM x.t)::integer - 1) AS monday
    FROM (SELECT p_now AT TIME ZONE 'America/Los_Angeles' AS t) x
  ) l;
$$;

-- Monday (Pacific date) of this week (Monday-Sunday): the call an admin's
-- takeaway is for. On Monday that is tonight's call; later in the week, the
-- call that just happened.
CREATE OR REPLACE FUNCTION public._family_squares_week_monday(p_now timestamptz DEFAULT now())
RETURNS date
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT x.t::date - (extract(isodow FROM x.t)::integer - 1)
  FROM (SELECT p_now AT TIME ZONE 'America/Los_Angeles' AS t) x;
$$;

REVOKE EXECUTE ON FUNCTION public._family_squares_latest_meeting_date(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._family_squares_week_monday(timestamptz) FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.family_call_takeaways (
  meeting_date date PRIMARY KEY,
  -- 150: the Tuesday note quotes it whole (older apps show it nowhere else).
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 150),
  updated_by uuid REFERENCES public.accounts(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.family_call_takeaways ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.family_call_takeaways FROM anon, authenticated;

-- The one thing from the most recent call, or NULL when none was written.
CREATE OR REPLACE FUNCTION public.family_call_takeaway()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date date := public._family_squares_latest_meeting_date(now());
  v_body text;
BEGIN
  IF public.my_account_id() IS NULL THEN RETURN NULL; END IF;
  SELECT t.body INTO v_body FROM public.family_call_takeaways t WHERE t.meeting_date = v_date;
  IF v_body IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('meeting_date', v_date, 'body', v_body);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.family_call_takeaway() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.family_call_takeaway() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_family_call_takeaway()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target date := public._family_squares_week_monday(now());
  v_live date := public._family_squares_latest_meeting_date(now());
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN jsonb_build_object(
    'meeting_date', v_target,
    'body', (SELECT t.body FROM public.family_call_takeaways t WHERE t.meeting_date = v_target),
    'live_meeting_date', v_live,
    'live_body', (SELECT t.body FROM public.family_call_takeaways t WHERE t.meeting_date = v_live)
  );
END;
$$;

-- Sets (or, with an empty line, clears) this week's one thing.
CREATE OR REPLACE FUNCTION public.admin_set_family_call_takeaway(p_body text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target date := public._family_squares_week_monday(now());
  v_body text := btrim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'));
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF v_body = '' THEN
    DELETE FROM public.family_call_takeaways WHERE meeting_date = v_target;
    RETURN jsonb_build_object('meeting_date', v_target, 'body', NULL);
  END IF;
  IF char_length(v_body) > 150 THEN
    RAISE EXCEPTION 'takeaway_too_long' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.family_call_takeaways (meeting_date, body, updated_by, updated_at)
  VALUES (v_target, v_body, public.my_account_id(), now())
  ON CONFLICT (meeting_date) DO UPDATE
    SET body = EXCLUDED.body, updated_by = EXCLUDED.updated_by, updated_at = now();
  RETURN jsonb_build_object('meeting_date', v_target, 'body', v_body);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_get_family_call_takeaway() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_family_call_takeaway(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_family_call_takeaway() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_family_call_takeaway(text) TO authenticated;

-- Tuesday's note for last night's call. Recipients: English members who still
-- want Monday call reminders, have a device, and either saved a seat for that
-- call or tapped Join during it. Sent at 10:30 AM where she is (clear of the
-- 8-9 AM morning note; now, if it is already later in her day), never after
-- 9 PM; one per member per call.
CREATE OR REPLACE FUNCTION public.enqueue_family_call_followups(p_now timestamptz DEFAULT clock_timestamp())
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local timestamp := p_now AT TIME ZONE 'America/Los_Angeles';
  v_session uuid := public.family_squares_session_id();
  v_meeting date;
  v_start timestamptz;
  v_end timestamptz;
  v_prev_end timestamptz;
  v_takeaway text;
  v_count integer := 0;
BEGIN
  -- pg_cron runs in UTC at both possible offsets; only the 1 AM Pacific
  -- Tuesday run enqueues.
  IF extract(isodow FROM v_local) <> 2 OR extract(hour FROM v_local) <> 1 OR v_session IS NULL THEN
    RETURN 0;
  END IF;
  v_meeting := v_local::date - 1;
  v_start := (v_meeting + time '19:00') AT TIME ZONE 'America/Los_Angeles';
  v_end := (v_meeting + time '20:00') AT TIME ZONE 'America/Los_Angeles';
  v_prev_end := ((v_meeting - 7) + time '20:00') AT TIME ZONE 'America/Los_Angeles';

  SELECT t.body INTO v_takeaway FROM public.family_call_takeaways t WHERE t.meeting_date = v_meeting;

  WITH targets AS (
    SELECT a.id, a.push_app_contract,
      CASE WHEN nullif(btrim(coalesce(a.timezone, '')), '') IS NULL THEN 'America/Los_Angeles'
        ELSE public._invitation_valid_tz(a.timezone) END AS tz
    FROM public.accounts a
    WHERE nullif(a.push_token, '') IS NOT NULL
      AND coalesce(a.family_call_reminders, false)
      -- Spanish members are invited to La Sobremesa, not The Family Squares.
      AND coalesce(a.locale, 'en') NOT LIKE 'es%'
      AND (
        EXISTS (
          SELECT 1 FROM public.session_rsvps r
          WHERE r.account_id = a.id AND r.session_id = v_session AND r.status = 'going'
            AND (r.family_squares_meeting_date = v_meeting
              -- 4.1 writes no occurrence: an undated seat saved during the
              -- week before the call was for this call.
              OR (r.family_squares_meeting_date IS NULL AND r.created_at > v_prev_end AND r.created_at < v_end))
        )
        OR EXISTS (
          SELECT 1 FROM public.funnel_events e
          WHERE e.account_id = a.id AND e.stage = 'attended'
            AND e.created_at >= v_start - interval '1 hour' AND e.created_at < v_end + interval '30 minutes'
        )
      )
  ), scheduled AS (
    SELECT t.id, t.tz, t.push_app_contract,
      CASE
        WHEN (p_now AT TIME ZONE t.tz)::time < time '10:30'
          THEN ((p_now AT TIME ZONE t.tz)::date + time '10:30') AT TIME ZONE t.tz
        WHEN (p_now AT TIME ZONE t.tz)::time < time '20:00' THEN p_now
        ELSE (((p_now AT TIME ZONE t.tz)::date + 1) + time '10:30') AT TIME ZONE t.tz
      END AS due
    FROM targets t
  )
  INSERT INTO public.push_outbox (account_id, kind, title, body, metadata, idempotency_key, scheduled_for, expires_at)
  SELECT s.id, 'family_call_followup', 'After Monday''s call',
    CASE
      -- Self-contained on any build.
      WHEN v_takeaway IS NOT NULL THEN 'This week''s one thing: ' || v_takeaway
      WHEN coalesce(s.push_app_contract, 0) >= 1 THEN
        'Your one thing to try this week is on Today, and next Monday''s seat is one tap away.'
      -- Older builds have no such card on Today.
      ELSE 'Thanks for being part of Monday''s call. You can save your seat for next Monday in the app.'
    END,
    jsonb_build_object('kind', 'family_call_followup', 'meeting_date', v_meeting::text),
    'family-call-followup:' || v_meeting || ':' || s.id,
    s.due,
    (((s.due AT TIME ZONE s.tz)::date) + time '21:00') AT TIME ZONE s.tz
  FROM scheduled s
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.enqueue_family_call_followups(timestamptz) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_job bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'shl-family-call-followup';
  IF v_job IS NOT NULL THEN
    PERFORM cron.unschedule(v_job);
  END IF;
  -- 1:10 AM Pacific Tuesday in both PDT (08:10 UTC) and PST (09:10 UTC).
  PERFORM cron.schedule('shl-family-call-followup', '10 8,9 * * 2',
    'SELECT public.enqueue_family_call_followups()');
END $$;

-- Questions for the call: screened on the way in, whatever the client.
ALTER TABLE public.session_questions ADD COLUMN IF NOT EXISTS crisis_tier text
  CHECK (crisis_tier IS NULL OR crisis_tier IN ('firm', 'told', 'resources'));

CREATE OR REPLACE FUNCTION public._session_question_screen()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Never client-supplied.
  NEW.crisis_tier := public._community_post_screen(NEW.question);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._session_question_screen() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS session_questions_screen ON public.session_questions;
CREATE TRIGGER session_questions_screen BEFORE INSERT OR UPDATE OF question, crisis_tier ON public.session_questions
FOR EACH ROW EXECUTE FUNCTION public._session_question_screen();

-- Admins hear about it now. At most one alert per member per hour; the admin
-- screen marks every such question.
CREATE OR REPLACE FUNCTION public._session_question_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.crisis_tier IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.push_outbox (account_id, kind, title, body, metadata, idempotency_key, expires_at)
  SELECT a.id, 'admin_session_question', '🆘 A question for Monday mentions a crisis',
    'A member''s question for the call mentions suicide, an overdose, self-harm or violence. Please check on them (Admin → Questions).',
    jsonb_build_object('kind', 'admin_session_question', 'question_id', NEW.id),
    'session-question-crisis:' || a.id || ':' || NEW.account_id || ':' || to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24'),
    now() + interval '24 hours'
  FROM public.accounts a
  JOIN auth.users u ON u.id = a.user_id
  WHERE lower(coalesce(u.email, '')) = ANY (public.admin_email_list())
    AND a.push_token IS NOT NULL
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._session_question_alert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS session_questions_alert ON public.session_questions;
CREATE TRIGGER session_questions_alert AFTER INSERT ON public.session_questions
FOR EACH ROW EXECUTE FUNCTION public._session_question_alert();

-- The admin list shows which questions need a look first. The default list
-- (Family Squares) also carries the last 30 days' crisis-flagged questions
-- for any other session (4.1 lets a member ask one for La Sobremesa), so the
-- alert always has a row to open.
DROP FUNCTION IF EXISTS public.admin_get_session_questions(text);
CREATE FUNCTION public.admin_get_session_questions(p_session_title text DEFAULT NULL)
RETURNS TABLE(id uuid, first_name text, last_name text, question text, submitted_at timestamptz, crisis_tier text,
  session_title text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session uuid := CASE
    WHEN p_session_title IS NULL THEN public.family_squares_session_id()
    ELSE (SELECT s.id FROM public.sessions s WHERE s.title = p_session_title LIMIT 1)
  END;
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY
  SELECT sq.id, a.first_name, a.last_name, sq.question, sq.created_at, sq.crisis_tier, s.title
  FROM public.session_questions sq
  JOIN public.accounts a ON a.id = sq.account_id
  JOIN public.sessions s ON s.id = sq.session_id
  WHERE sq.session_id = v_session
     OR (p_session_title IS NULL AND sq.crisis_tier IS NOT NULL AND sq.created_at > now() - interval '30 days')
  ORDER BY sq.created_at DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_get_session_questions(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_session_questions(text) TO authenticated;

-- Delivery rules for the two new push kinds (otherwise unchanged from
-- 20261103110000_textline_archive_keeps_unread_visible).
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

-- Winback skips members with a Tuesday note from the last 36 hours (otherwise
-- unchanged from 20261103170000_family_call_invite_local_hours).
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
