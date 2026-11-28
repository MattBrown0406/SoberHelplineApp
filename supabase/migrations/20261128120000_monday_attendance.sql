BEGIN;
CREATE TABLE public.monday_meetings (
 meeting_date date PRIMARY KEY CHECK(extract(isodow FROM meeting_date)=1),
 topic text NOT NULL DEFAULT '' CHECK(length(topic)<=120),
 takeaway text NOT NULL DEFAULT '' CHECK(length(takeaway)<=240),
 zoom_uuid text UNIQUE CHECK(length(zoom_uuid)<=200),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.monday_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 welcome_url text NOT NULL DEFAULT '' CHECK(welcome_url='' OR welcome_url ~ '^https://(www\.)?(youtube\.com|youtu\.be|vimeo\.com|soberhelpline\.com)/[^[:space:]]+$'),
 reminders_enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.monday_settings(id) VALUES(true);
CREATE TABLE public.monday_reflections (
 account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 meeting_date date NOT NULL CHECK(extract(isodow FROM meeting_date)=1),
 body text NOT NULL CHECK(length(body)<=1000), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,meeting_date)
);
CREATE TABLE public.monday_card_views (
 account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 meeting_date date NOT NULL CHECK(extract(isodow FROM meeting_date)=1),
 PRIMARY KEY(account_id,meeting_date)
);
CREATE TABLE public.monday_zoom_attendance (
 account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
 meeting_date date NOT NULL REFERENCES public.monday_meetings(meeting_date),
 seconds integer NOT NULL CHECK(seconds BETWEEN 0 AND 86400),
 PRIMARY KEY(account_id,meeting_date)
);
CREATE TABLE public.monday_zoom_reports (
 meeting_date date PRIMARY KEY REFERENCES public.monday_meetings(meeting_date),
 unmatched integer NOT NULL CHECK(unmatched>=0), synced_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.monday_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monday_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monday_reflections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monday_card_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monday_zoom_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monday_zoom_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.monday_meetings,public.monday_settings,public.monday_reflections,public.monday_card_views,public.monday_zoom_attendance,public.monday_zoom_reports FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.monday_meeting_details(p_date date) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE WHEN public.my_account_id() IS NULL THEN NULL ELSE jsonb_build_object(
 'meeting_date',p_date,'topic',coalesce(m.topic,''),'takeaway',coalesce(m.takeaway,''),'welcome_url',s.welcome_url)
 END FROM public.monday_settings s LEFT JOIN public.monday_meetings m ON m.meeting_date=p_date WHERE s.id;
$$;
CREATE FUNCTION public.admin_save_monday_meeting(p_date date,p_topic text,p_takeaway text,p_welcome_url text,p_zoom_uuid text,p_reminders_enabled boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT public.is_admin_jwt() THEN RAISE EXCEPTION 'not authorized' USING ERRCODE='42501'; END IF;
 INSERT INTO public.monday_meetings(meeting_date,topic,takeaway,zoom_uuid) VALUES(p_date,btrim(p_topic),btrim(p_takeaway),nullif(btrim(p_zoom_uuid),''))
 ON CONFLICT(meeting_date) DO UPDATE SET topic=excluded.topic,takeaway=excluded.takeaway,zoom_uuid=excluded.zoom_uuid,updated_at=now();
 UPDATE public.monday_settings SET welcome_url=btrim(p_welcome_url),reminders_enabled=p_reminders_enabled WHERE id;
END $$;
CREATE FUNCTION public.admin_monday_meeting(p_date date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT public.is_admin_jwt() THEN RAISE EXCEPTION 'not authorized' USING ERRCODE='42501'; END IF;
 RETURN (SELECT jsonb_build_object('meeting_date',p_date,'topic',coalesce(m.topic,''),'takeaway',coalesce(m.takeaway,''),'zoom_uuid',coalesce(m.zoom_uuid,''),'welcome_url',s.welcome_url,'reminders_enabled',s.reminders_enabled)
 FROM public.monday_settings s LEFT JOIN public.monday_meetings m ON m.meeting_date=p_date WHERE s.id);
END $$;
CREATE FUNCTION public.monday_save_reflection(p_date date,p_body text,p_expected_account uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=public.my_account_id(); BEGIN
 IF a IS NULL OR a IS DISTINCT FROM p_expected_account THEN RAISE EXCEPTION 'not authorized' USING ERRCODE='42501'; END IF;
 IF p_date > (now() AT TIME ZONE 'America/Los_Angeles')::date OR p_date < current_date-365 THEN RAISE EXCEPTION 'invalid date'; END IF;
 IF btrim(p_body)='' THEN DELETE FROM public.monday_reflections WHERE account_id=a AND meeting_date=p_date;
 ELSE INSERT INTO public.monday_reflections(account_id,meeting_date,body) VALUES(a,p_date,btrim(p_body)) ON CONFLICT(account_id,meeting_date) DO UPDATE SET body=excluded.body,updated_at=now(); END IF;
END $$;
CREATE FUNCTION public.monday_reflection(p_date date) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT body FROM public.monday_reflections WHERE account_id=public.my_account_id() AND meeting_date=p_date $$;
CREATE FUNCTION public.monday_card_viewed(p_date date) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid:=public.my_account_id(); BEGIN
 IF a IS NULL THEN RETURN; END IF;
 IF p_date NOT BETWEEN current_date-1 AND current_date+8 THEN RETURN; END IF;
 INSERT INTO public.monday_card_views VALUES(a,p_date) ON CONFLICT DO NOTHING;
END $$;

-- Only the authenticated server reconciler can write verified attendance.
-- Emails are used in memory for exact verified-account matching and never stored here.
CREATE FUNCTION public.service_monday_import_attendance(p_date date,p_uuid text,p_rows jsonb,p_unmatched integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row jsonb; ids uuid[]; a uuid; unknown_count integer:=p_unmatched;
BEGIN
 IF p_rows IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)>10000 OR p_unmatched IS NULL OR p_unmatched<0 THEN RAISE EXCEPTION 'invalid report'; END IF;
 PERFORM 1 FROM public.monday_meetings WHERE meeting_date=p_date AND zoom_uuid=p_uuid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'unknown occurrence'; END IF;
 DELETE FROM public.monday_zoom_attendance WHERE meeting_date=p_date;
 FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
   IF jsonb_typeof(row) IS DISTINCT FROM 'object' OR nullif(row->>'email','') IS NULL OR jsonb_typeof(row->'seconds') IS DISTINCT FROM 'number' OR (row->>'seconds') !~ '^[0-9]+$' OR (row->>'seconds')::numeric>86400 THEN RAISE EXCEPTION 'invalid report row'; END IF;
   SELECT array_agg(ac.id) INTO ids FROM public.accounts ac JOIN auth.users u ON u.id=ac.user_id
   WHERE u.email_confirmed_at IS NOT NULL AND lower(u.email)=lower(nullif(row->>'email',''));
   IF cardinality(ids)=1 THEN
     a:=ids[1];
     INSERT INTO public.monday_zoom_attendance VALUES(a,p_date,(row->>'seconds')::integer)
     ON CONFLICT(account_id,meeting_date) DO UPDATE SET seconds=greatest(public.monday_zoom_attendance.seconds,excluded.seconds);
   ELSE unknown_count:=unknown_count+1; END IF;
 END LOOP;
 INSERT INTO public.monday_zoom_reports(meeting_date,unmatched) VALUES(p_date,unknown_count)
 ON CONFLICT(meeting_date) DO UPDATE SET unmatched=excluded.unmatched,synced_at=now();
END $$;
CREATE FUNCTION public.service_monday_occurrence(p_date date) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT zoom_uuid FROM public.monday_meetings WHERE meeting_date=p_date $$;
CREATE FUNCTION public.monday_reminders_enabled() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT reminders_enabled FROM public.monday_settings WHERE id $$;

CREATE FUNCTION public.admin_monday_attendance() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF NOT public.is_admin_jwt() THEN RAISE EXCEPTION 'not authorized' USING ERRCODE='42501'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('meeting_date',d,
 'views',(SELECT count(*) FROM public.monday_card_views WHERE meeting_date=d),
 'rsvps',coalesce((SELECT rsvps FROM public.family_squares_meeting_stats WHERE meeting_date=d),(SELECT going FROM public._family_squares_rsvp_counts(d))),
 'join_taps',(SELECT count(DISTINCT account_id) FROM public.funnel_events WHERE stage='attended' AND created_at >= (d+time '18:30') AT TIME ZONE 'America/Los_Angeles' AND created_at < (d+time '20:00') AT TIME ZONE 'America/Los_Angeles'),
 'return_signals',(SELECT count(DISTINCT account_id) FROM public.funnel_events WHERE stage='attended_10min' AND metadata->>'meeting_date'=d::text),
 'confirmed',CASE WHEN r.synced_at IS NOT NULL THEN (SELECT count(*) FROM public.monday_zoom_attendance WHERE meeting_date=d AND seconds>0) END,
 'confirmed_10min',CASE WHEN r.synced_at IS NOT NULL THEN (SELECT count(*) FROM public.monday_zoom_attendance WHERE meeting_date=d AND seconds>=600) END,
 'returned_next_week',CASE WHEN r.synced_at IS NOT NULL AND EXISTS(SELECT 1 FROM public.monday_zoom_reports WHERE meeting_date=d+7) THEN (SELECT count(*) FROM public.monday_zoom_attendance a JOIN public.monday_zoom_attendance b USING(account_id) WHERE a.meeting_date=d AND b.meeting_date=d+7 AND a.seconds>0 AND b.seconds>0) END,
 'unmatched',r.unmatched,'synced_at',r.synced_at) ORDER BY d DESC),'[]'::jsonb)
 FROM (SELECT (public._family_squares_latest_meeting_date(now())+7-7*g)::date AS d FROM generate_series(0,8) g) dates
 LEFT JOIN public.monday_zoom_reports r ON r.meeting_date=d);
END $$;

REVOKE ALL ON FUNCTION public.monday_meeting_details(date),public.admin_save_monday_meeting(date,text,text,text,text,boolean),public.admin_monday_meeting(date),public.monday_save_reflection(date,text,uuid),public.monday_reflection(date),public.monday_card_viewed(date),public.admin_monday_attendance(),public.monday_reminders_enabled() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.monday_meeting_details(date),public.admin_save_monday_meeting(date,text,text,text,text,boolean),public.admin_monday_meeting(date),public.monday_save_reflection(date,text,uuid),public.monday_reflection(date),public.monday_card_viewed(date),public.admin_monday_attendance() TO authenticated;
REVOKE ALL ON FUNCTION public.service_monday_import_attendance(date,text,jsonb,integer),public.service_monday_occurrence(date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.service_monday_import_attendance(date,text,jsonb,integer),public.service_monday_occurrence(date),public.monday_reminders_enabled() TO service_role;
CREATE FUNCTION public.monday_followup() RETURNS date LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE d date:=public._family_squares_latest_meeting_date(now()); a uuid:=public.my_account_id(); BEGIN
 IF now() < (d+time '20:00') AT TIME ZONE 'America/Los_Angeles' THEN d:=d-7; END IF;
 IF EXISTS(SELECT 1 FROM public.monday_zoom_attendance WHERE account_id=a AND meeting_date=d AND seconds>0)
 OR EXISTS(SELECT 1 FROM public.funnel_events WHERE account_id=a AND stage='attended_10min' AND metadata->>'meeting_date'=d::text)
 THEN RETURN d; END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.monday_followup() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.monday_followup() TO authenticated;
COMMIT;
