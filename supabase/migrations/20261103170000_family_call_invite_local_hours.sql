-- The default-on "The Family Squares starts in 30 minutes" invitation (sent
-- Monday 6:30 PM Pacific to English members who haven't RSVP'd) reached
-- members abroad in the middle of their night. Only send it 8 AM-10 PM in her
-- own time zone, like the win-back push. Otherwise unchanged (dispatcher_job_delivery(text,uuid,uuid,timestamp with time zone,timestamp with time zone,boolean)).

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
END $function$;
