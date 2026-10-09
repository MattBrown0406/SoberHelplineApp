-- =====================================================================
-- La Sobremesa: the Spanish Monday call (8:00 PM Pacific, AyudaSobria.com)
-- for members using the app in Spanish; The Family Squares (7:00 PM) stays
-- the English call. Re-runnable.
--
-- * sessions.language ('en' | 'es' | NULL = everyone). Members see the calls
--   in their language (accounts.locale, which the app keeps in step with the
--   language it shows), so older app builds also show the right call.
-- * La Sobremesa uses Zoom registration: each family gets a personal link.
--   The la-sobremesa-register function registers the member with
--   AyudaSobria and keeps that link in session_join_links (owner-readable).
-- * next_at is kept on the next Monday 8:00 PM Pacific; RSVPs and personal
--   links reset with The Family Squares' every Tuesday 2 AM Pacific.
-- * The Family Squares push reminders skip Spanish members.
-- =====================================================================

ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS language text;
DO $$ BEGIN
  ALTER TABLE public.sessions ADD CONSTRAINT sessions_language_check CHECK (language IN ('en', 'es'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

UPDATE public.sessions SET language = 'en'
WHERE id = public.family_squares_session_id() AND language IS NULL;

-- Next Monday 8:00 PM Pacific that hasn't ended (the call runs 75 minutes).
CREATE OR REPLACE FUNCTION public.next_la_sobremesa_start(p_now timestamptz DEFAULT now())
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT min(s.start_at) FROM (
    SELECT ((d::date + time '20:00') AT TIME ZONE 'America/Los_Angeles') AS start_at
    FROM generate_series(
      (p_now AT TIME ZONE 'America/Los_Angeles')::date,
      (p_now AT TIME ZONE 'America/Los_Angeles')::date + 8,
      interval '1 day'
    ) AS d
    WHERE extract(isodow FROM d) = 1
  ) s
  WHERE s.start_at + interval '75 minutes' > p_now;
$$;
REVOKE ALL ON FUNCTION public.next_la_sobremesa_start(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.next_la_sobremesa_start(timestamptz) TO service_role;

-- zoom_url is AyudaSobria's registration page: app builds before this change open it
-- from Join (registration there emails the personal link). Newer builds replace it
-- with the member's own link, or offer "reserve" when they have none.
INSERT INTO public.sessions (kind, title, schedule_label, next_at, zoom_url, visibility, language)
SELECT 'group', 'La Sobremesa', 'Lunes · 8:00 PM (Pacífico) · Zoom',
       public.next_la_sobremesa_start(), 'https://ayudasobria.com/registro', 'all', 'es'
WHERE NOT EXISTS (SELECT 1 FROM public.sessions WHERE title = 'La Sobremesa');

CREATE OR REPLACE FUNCTION public.la_sobremesa_session_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.sessions WHERE title = 'La Sobremesa' ORDER BY created_at LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.la_sobremesa_session_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.la_sobremesa_session_id() TO authenticated, service_role;

-- Calls in the member's language, plus calls for everyone.
DROP POLICY IF EXISTS "sessions: visible" ON public.sessions;
CREATE POLICY "sessions: visible" ON public.sessions FOR SELECT
  USING (
    (
      visibility = 'all'
      OR (visibility = 'org' AND org_id IN
          (SELECT org_id FROM public.accounts WHERE user_id = auth.uid()))
    )
    AND (
      language IS NULL
      OR language = CASE
        WHEN (SELECT a.locale FROM public.accounts a WHERE a.user_id = auth.uid()) LIKE 'es%' THEN 'es'
        ELSE 'en'
      END
    )
  );

-- Each member's personal Zoom link for a registration-based call.
CREATE TABLE IF NOT EXISTS public.session_join_links (
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  join_url   text NOT NULL CHECK (join_url ~ '^https://([a-z0-9-]+\.)?zoom\.us/'),
  starts_at  timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, account_id)
);
ALTER TABLE public.session_join_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.session_join_links FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.session_join_links TO authenticated;
GRANT ALL ON TABLE public.session_join_links TO service_role;
DROP POLICY IF EXISTS "session_join_links: owner read" ON public.session_join_links;
CREATE POLICY "session_join_links: owner read" ON public.session_join_links FOR SELECT
  USING (account_id = public.my_account_id());

CREATE OR REPLACE FUNCTION public.refresh_la_sobremesa_next_at()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.sessions
  SET next_at = public.next_la_sobremesa_start()
  WHERE id = public.la_sobremesa_session_id()
    AND next_at IS DISTINCT FROM public.next_la_sobremesa_start();
$$;
REVOKE ALL ON FUNCTION public.refresh_la_sobremesa_next_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_la_sobremesa_next_at() TO service_role;

-- Same weekly reset as before, now for both Monday calls (and the personal links).
CREATE OR REPLACE FUNCTION public.reset_family_squares_weekly_rsvps()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local_now timestamp := clock_timestamp() AT TIME ZONE 'America/Los_Angeles';
  v_deleted integer := 0;
  v_links integer := 0;
BEGIN
  -- pg_cron runs in UTC. The job runs at both possible UTC offsets and this
  -- guard makes exactly the 2 AM Pacific invocation perform the reset.
  IF extract(isodow FROM v_local_now) <> 2 OR extract(hour FROM v_local_now) <> 2 THEN
    RETURN 0;
  END IF;

  DELETE FROM public.session_rsvps
  WHERE session_id IN (public.family_squares_session_id(), public.la_sobremesa_session_id());
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  DELETE FROM public.session_join_links WHERE starts_at < clock_timestamp();
  GET DIAGNOSTICS v_links = ROW_COUNT;
  RETURN v_deleted + v_links;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reset_family_squares_weekly_rsvps() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_family_squares_weekly_rsvps() TO service_role;

-- The community "N families are joining …" line: the caller's language's call.
CREATE OR REPLACE FUNCTION public.upcoming_call_rsvp_count()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session sessions;
  v_count   int;
  v_locale  text := CASE WHEN (SELECT locale FROM accounts WHERE user_id = auth.uid()) LIKE 'es%'
                     THEN 'es' ELSE 'en' END;
BEGIN
  SELECT * INTO v_session FROM sessions
   WHERE kind = 'group' AND (next_at IS NULL OR next_at >= now())
     AND (language IS NULL OR language = v_locale)
   ORDER BY next_at ASC NULLS LAST
   LIMIT 1;

  IF NOT FOUND THEN
    SELECT * INTO v_session FROM sessions
     WHERE kind = 'group' AND (language IS NULL OR language = v_locale)
     ORDER BY next_at DESC NULLS LAST
     LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('count', 0, 'schedule_label', NULL, 'title', NULL, 'next_at', NULL);
  END IF;

  SELECT count(*) INTO v_count
  FROM session_rsvps
  WHERE session_id = v_session.id AND status = 'going';

  RETURN jsonb_build_object(
    'count', v_count,
    'schedule_label', v_session.schedule_label,
    'title', v_session.title,
    'next_at', v_session.next_at
  );
END;
$$;

-- The Family Squares reminders (1 hour / 30 minutes) skip Spanish members.
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

-- next_at every 10 minutes; the 15-minute-before La Sobremesa push (Monday
-- 7:45 PM Pacific, both UTC offsets; the function sends only at the right hour).
DO $$
DECLARE j record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RETURN; END IF;
  FOR j IN SELECT jobid FROM cron.job
    WHERE jobname IN ('shl-la-sobremesa-next-at', 'shl-la-sobremesa-reminder')
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
  PERFORM cron.schedule('shl-la-sobremesa-next-at', '*/10 * * * *',
    'SELECT public.refresh_la_sobremesa_next_at();');
  PERFORM cron.schedule('shl-la-sobremesa-reminder', '45 2,3 * * 2', $cmd$
    SELECT net.http_post(
      url     := 'https://rjlkbxqxshohgjmomyro.supabase.co/functions/v1/notify-la-sobremesa',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1
        )
      ),
      body    := '{}'::jsonb
    );
  $cmd$);
END $$;
