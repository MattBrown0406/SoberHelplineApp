BEGIN;
-- Force the real reset definition's clock inside this rolled-back test only.
DO $$ DECLARE definition text; BEGIN
  SELECT pg_get_functiondef('public.reset_family_squares_weekly_rsvps()'::regprocedure) INTO definition;
  EXECUTE replace(definition, 'clock_timestamp()', '''2026-10-13T09:00:00Z''::timestamptz');
END $$;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
INSERT INTO public.session_rsvps(session_id,account_id,status,family_squares_meeting_date) VALUES
 ('english','past','going','2026-10-12'), ('english','future','going','2026-10-19'),
 ('english','legacy','going',NULL), ('spanish','future','going',NULL), ('spanish','past','going',NULL),
 ('other','control','going',NULL);
INSERT INTO public.session_join_links VALUES ('spanish','future','2026-10-20T03:00:00Z'), ('spanish','past','2026-10-13T03:00:00Z');
SELECT public.reset_family_squares_weekly_rsvps();
DO $$ BEGIN
 IF (SELECT count(*) FROM public.session_rsvps) <> 3 THEN RAISE EXCEPTION 'reset row count'; END IF;
 IF NOT EXISTS (SELECT FROM public.session_rsvps WHERE session_id='english' AND account_id='future') THEN RAISE EXCEPTION 'lost new-week English'; END IF;
 IF NOT EXISTS (SELECT FROM public.session_rsvps WHERE session_id='spanish' AND account_id='future') THEN RAISE EXCEPTION 'changed Spanish'; END IF;
 IF NOT EXISTS (SELECT FROM public.session_rsvps WHERE session_id='other') THEN RAISE EXCEPTION 'changed unrelated'; END IF;
 IF has_function_privilege('authenticated','public.reset_family_squares_weekly_rsvps()','EXECUTE') THEN RAISE EXCEPTION 'public reset'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"role":"authenticated"}',false);
INSERT INTO public.session_rsvps(session_id,account_id,status,family_squares_meeting_date) VALUES ('english','forged','going','2026-10-19');
UPDATE public.session_rsvps SET family_squares_meeting_date='2030-01-01' WHERE account_id='future';
DO $$ BEGIN
 IF EXISTS (SELECT FROM public.session_rsvps WHERE account_id='forged' AND family_squares_meeting_date IS NOT NULL) THEN RAISE EXCEPTION 'client forged snapshot'; END IF;
 IF EXISTS (SELECT FROM public.session_rsvps WHERE account_id='future' AND family_squares_meeting_date='2030-01-01') THEN RAISE EXCEPTION 'client changed snapshot'; END IF;
END $$;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',false);
INSERT INTO public.session_rsvps(session_id,account_id,status,family_squares_meeting_date) VALUES ('english','future','going','2026-10-19')
ON CONFLICT(session_id,account_id) DO UPDATE SET status=excluded.status,family_squares_meeting_date=excluded.family_squares_meeting_date;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.session_rsvps WHERE session_id='english' AND account_id='future') <> 1 THEN RAISE EXCEPTION 'duplicate RSVP'; END IF;
END $$;
ROLLBACK;
