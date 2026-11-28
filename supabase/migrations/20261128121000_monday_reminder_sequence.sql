BEGIN;
CREATE TABLE public.monday_reminder_sends(
 account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 meeting_date date NOT NULL,
 phase text NOT NULL CHECK(phase IN ('preview','morning','join')),
 claimed_at timestamptz NOT NULL DEFAULT now(),
 outcome text NOT NULL DEFAULT 'claimed' CHECK(outcome IN ('claimed','sent','failed','skipped')),
 PRIMARY KEY(account_id,meeting_date,phase)
);
ALTER TABLE public.monday_reminder_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.monday_reminder_sends FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.service_monday_reminder_delivery(p_account uuid,p_date date,p_phase text,p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.accounts; start_at timestamptz; member_time timestamp; meeting_local date; until_at timestamptz; seat boolean; BEGIN
 IF NOT public.monday_reminders_enabled() OR extract(isodow FROM p_date)<>1 THEN RETURN NULL; END IF;
 SELECT * INTO a FROM public.accounts WHERE id=p_account;
 IF NOT FOUND OR nullif(a.push_token,'') IS NULL OR NOT coalesce(a.family_call_reminders,false)
 OR coalesce(a.locale,'en') LIKE 'es%' OR public._dispatcher_admin(a.id) OR public._account_reminders_paused(a.id) THEN RETURN NULL; END IF;
 -- A cancellation stays cancelled until the website explicitly clears it.
 IF EXISTS(SELECT 1 FROM public.family_squares_meeting_status WHERE meeting_date=p_date AND cancelled) THEN RETURN NULL; END IF;
 IF EXISTS(SELECT 1 FROM public.session_rsvps WHERE account_id=a.id AND session_id=public.family_squares_session_id() AND status='declined' AND (family_squares_meeting_date=p_date OR (family_squares_meeting_date IS NULL AND created_at>(p_date-6)::timestamp AT TIME ZONE 'America/Los_Angeles'))) THEN RETURN NULL; END IF;
 start_at:=(p_date+time '19:00') AT TIME ZONE 'America/Los_Angeles';
 IF p_now>=start_at THEN RETURN NULL; END IF;
 member_time:=p_now AT TIME ZONE public._invitation_valid_tz(a.timezone);
 meeting_local:=(start_at AT TIME ZONE public._invitation_valid_tz(a.timezone))::date;
 SELECT EXISTS(SELECT 1 FROM public.session_rsvps WHERE account_id=a.id AND session_id=public.family_squares_session_id() AND status='going' AND (family_squares_meeting_date=p_date OR (family_squares_meeting_date IS NULL AND created_at>(p_date-6)::timestamp AT TIME ZONE 'America/Los_Angeles'))) INTO seat;
 IF p_phase='preview' AND member_time::date=meeting_local-1 AND member_time::time>=time '17:00' AND member_time::time<time '18:00' THEN
   until_at:=least(start_at,(member_time::date+time '18:00') AT TIME ZONE public._invitation_valid_tz(a.timezone));
 ELSIF p_phase='morning' AND seat AND member_time::date=meeting_local AND member_time::time>=time '09:00' AND member_time::time<time '10:00' THEN
   until_at:=least(start_at,(member_time::date+time '10:00') AT TIME ZONE public._invitation_valid_tz(a.timezone));
 ELSIF p_phase='join' AND seat AND p_now>=start_at-interval '15 minutes' THEN until_at:=start_at;
 ELSE RETURN NULL; END IF;
 RETURN jsonb_build_object('account_id',a.id,'meeting_date',p_date,'phase',p_phase,'push_token',a.push_token,'session_id',public.family_squares_session_id(),'expires_at',until_at);
END $$;
CREATE FUNCTION public.service_monday_reminder_candidates() RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH dates AS (SELECT public._family_squares_latest_meeting_date(now())+g*7 AS d FROM generate_series(0,1) g)
 SELECT delivery FROM public.accounts a CROSS JOIN dates CROSS JOIN (VALUES('preview'),('morning'),('join')) phases(phase)
 CROSS JOIN LATERAL (SELECT public.service_monday_reminder_delivery(a.id,d,phase) AS delivery) result
 WHERE delivery IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.monday_reminder_sends s WHERE s.account_id=a.id AND s.meeting_date=d AND s.phase=phases.phase)
 ORDER BY a.id LIMIT 200;
$$;
CREATE FUNCTION public.service_claim_monday_reminder(p_account uuid,p_date date,p_phase text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE delivery jsonb; BEGIN
 delivery:=public.service_monday_reminder_delivery(p_account,p_date,p_phase,clock_timestamp());IF delivery IS NULL THEN RETURN NULL; END IF;
 INSERT INTO public.monday_reminder_sends(account_id,meeting_date,phase) VALUES(p_account,p_date,p_phase) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN NULL; END IF;
 RETURN public.service_monday_reminder_delivery(p_account,p_date,p_phase,clock_timestamp());
END $$;
CREATE FUNCTION public.service_finish_monday_reminder(p_account uuid,p_date date,p_phase text,p_outcome text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 UPDATE public.monday_reminder_sends SET outcome=p_outcome WHERE account_id=p_account AND meeting_date=p_date AND phase=p_phase AND outcome='claimed';
$$;
REVOKE ALL ON FUNCTION public.service_monday_reminder_delivery(uuid,date,text,timestamptz),public.service_monday_reminder_candidates(),public.service_claim_monday_reminder(uuid,date,text),public.service_finish_monday_reminder(uuid,date,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_monday_reminder_delivery(uuid,date,text,timestamptz),public.service_monday_reminder_candidates(),public.service_claim_monday_reminder(uuid,date,text),public.service_finish_monday_reminder(uuid,date,text,text) TO service_role;

-- Preserve legacy behavior until the coordinator is explicitly activated.
ALTER FUNCTION public.dispatcher_job_delivery(text,uuid,uuid,timestamptz,timestamptz,boolean) RENAME TO _pre_monday_sequence_job_delivery;
REVOKE ALL ON FUNCTION public._pre_monday_sequence_job_delivery(text,uuid,uuid,timestamptz,timestamptz,boolean) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.dispatcher_job_delivery(p_job text,p_account_id uuid,p_session_id uuid,p_expires_at timestamptz,p_now timestamptz DEFAULT now(),p_force boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF public.monday_reminders_enabled() AND p_job IN ('session_reminder','family_call_30min') THEN RETURN NULL; END IF;
 RETURN public._pre_monday_sequence_job_delivery(p_job,p_account_id,p_session_id,p_expires_at,p_now,p_force);
END $$;
REVOKE ALL ON FUNCTION public.dispatcher_job_delivery(text,uuid,uuid,timestamptz,timestamptz,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dispatcher_job_delivery(text,uuid,uuid,timestamptz,timestamptz,boolean) TO service_role;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
 PERFORM cron.schedule('monday-attendance-reminders','*/5 * * * *',$cron$
 SELECT net.http_post(url:='https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/monday-reminders',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)),body:='{}'::jsonb)
 WHERE public.monday_reminders_enabled() AND EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='SUPABASE_SERVICE_ROLE_KEY' AND decrypted_secret IS NOT NULL);$cron$);
 END IF;
END $$;
COMMIT;
