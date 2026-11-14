-- A cancelled Monday is not announced.
--
-- soberhelpline.com can cancel a Family Squares meeting. The app now knows
-- (public.family_squares_meeting_status, written by family-squares-web-sync
-- every 15 minutes; see 20261114120000), and the two Monday pushes sent by
-- send-engagement-push stay quiet for a cancelled meeting:
--   * session_reminder   "starts in about an hour and your seat is saved"
--   * family_call_30min  "starts in 30 minutes" (members without a seat)
-- Both are decided here: dispatcher_job_targets picks who to send to with
-- this function, and claim_dispatcher_job asks it again just before each
-- send, so a meeting cancelled a minute before 6 PM is still caught. Seats
-- saved before the cancellation are left as they are; this is what keeps
-- their reminder from going out.
--
-- The other Family Squares pushes ask the same question where they are sent:
-- the 15-minute reminder (notify-session-reminder), Monday's morning note
-- (notify-daily-morning) and Tuesday's follow-up (20261114140000). La
-- Sobremesa, winback and every other push are untouched.
--
-- Otherwise unchanged from 20261105140000_bereavement_quiet: the bereavement
-- pause, the reminder switch, the RSVP rules, the invite's local hours, the
-- send windows and forced previews are exactly as they were.

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
   -- The website cancelled that Monday (family_squares_meeting_cancelled):
   -- neither the reminder nor the invite is sent, on a real run or a forced
   -- one. Asked last, and only for a member who would otherwise get the push.
   -- If it cannot be read the answer is "not cancelled": sent as before.
   IF coalesce(allowed,false) AND family_squares_meeting_cancelled((deadline AT TIME ZONE 'America/Los_Angeles')::date) THEN
     allowed:=false;
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

REVOKE ALL ON FUNCTION public.dispatcher_job_delivery(text, uuid, uuid, timestamptz, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatcher_job_delivery(text, uuid, uuid, timestamptz, timestamptz, boolean) TO service_role;
