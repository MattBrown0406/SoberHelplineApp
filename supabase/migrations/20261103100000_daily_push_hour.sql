-- The member's chosen daily reminder hour (Settings offers 8, 12, 18 and 21;
-- NULL = the 9 AM default). One opt-in drives two senders: the server morning
-- note and the device's check-in nudge. With the hour on the server, a morning
-- choice gets only the morning note at her hour and a later choice gets only
-- the device nudge, instead of both at 9 AM plus her own time.
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS daily_push_hour smallint
  CHECK (daily_push_hour IS NULL OR daily_push_hour BETWEEN 0 AND 23);

GRANT SELECT (daily_push_hour) ON public.accounts TO authenticated;

CREATE OR REPLACE FUNCTION public.set_daily_push_hour(p_hour integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_hour IS NULL OR p_hour < 0 OR p_hour > 23 THEN
    RAISE EXCEPTION 'invalid_preference' USING ERRCODE = '22023';
  END IF;
  UPDATE public.accounts
  SET daily_push_hour = p_hour
  WHERE id = public.my_account_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_account' USING ERRCODE = '28000';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_daily_push_hour(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_daily_push_hour(integer) TO authenticated;
