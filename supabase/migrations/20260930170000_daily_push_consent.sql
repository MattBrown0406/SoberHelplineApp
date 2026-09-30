-- =============================================================================
-- Daily pushes honour the member's daily-reminder choice.
--
-- The daily-reminder toggle lived only on the device, so turning it off in
-- Settings (or never opting in, then registering a token by RSVPing or enabling
-- practice pushes) still left the member on the server's 9am morning push.
-- The app now mirrors its explicit choice here and the morning push only goes
-- to members who opted in.
--
-- Members already holding a push token keep today's behaviour until their
-- device next opens the app and reports its actual setting.
-- =============================================================================

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS daily_push_opt_in boolean NOT NULL DEFAULT false;

UPDATE public.accounts
SET daily_push_opt_in = true
WHERE push_token IS NOT NULL
  AND daily_push_opt_in = false;

CREATE OR REPLACE FUNCTION public.set_daily_push_opt_in(p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'invalid_preference' USING ERRCODE = '22023';
  END IF;
  UPDATE public.accounts
  SET daily_push_opt_in = p_enabled
  WHERE id = public.my_account_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_account' USING ERRCODE = '28000';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_daily_push_opt_in(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_daily_push_opt_in(boolean) TO authenticated;
