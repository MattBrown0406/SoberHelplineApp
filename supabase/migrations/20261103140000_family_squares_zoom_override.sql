-- Admin "Update Link" for the Family Squares Zoom link (e.g. tonight's
-- website meeting broke) was overwritten by zoom-sync within 10 minutes,
-- because zoom-sync copies the website's link whenever it differs. The admin
-- link now holds until that call ends; zoom-sync then follows the website
-- again (it creates each week's meeting).
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS zoom_url_override_until timestamptz;

CREATE OR REPLACE FUNCTION public.admin_update_family_squares_zoom_url(p_url text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_local_now timestamp := now() AT TIME ZONE 'America/Los_Angeles';
  v_monday date;
  v_next_end timestamptz;
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  -- The end (8 PM Pacific) of the next Monday call that has not ended yet,
  -- stepped on the Pacific calendar so a DST change can't shift it an hour.
  v_monday := v_local_now::date + ((8 - extract(isodow FROM v_local_now)::integer) % 7);
  IF (v_monday + time '20:00') <= v_local_now THEN
    v_monday := v_monday + 7;
  END IF;
  v_next_end := (v_monday + time '20:00') AT TIME ZONE 'America/Los_Angeles';
  UPDATE public.sessions
  SET zoom_url = p_url,
      -- next_at is the start of the call members see (tonight's until it ends);
      -- right after a call, before zoom-sync moves it on, use the next call.
      zoom_url_override_until = CASE
        WHEN next_at IS NOT NULL AND next_at + interval '1 hour' > now() THEN next_at + interval '1 hour'
        ELSE v_next_end
      END
  WHERE id = public.family_squares_session_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Family Squares session row not found — zoom link NOT saved';
  END IF;
END;
$function$;
