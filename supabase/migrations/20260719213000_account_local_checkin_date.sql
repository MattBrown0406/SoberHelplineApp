-- Align cloud uniqueness with the member's account-local calendar day. The app
-- asks for one check-in per local day; uniqueness on UTC(created_at) rejected a
-- legitimate next-day check-in for western time zones.

ALTER TABLE public.checkins
  ADD COLUMN IF NOT EXISTS checkin_date date;

UPDATE public.checkins c
SET checkin_date = (c.created_at AT TIME ZONE COALESCE(NULLIF(a.timezone, ''), 'UTC'))::date
FROM public.accounts a
WHERE a.id = c.account_id
  AND c.checkin_date IS NULL;

-- Derive the date server-side as well as in current clients. This keeps older
-- installed app versions and trusted server writers compatible after the new
-- NOT NULL constraint ships.
CREATE OR REPLACE FUNCTION public.set_checkin_local_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_timezone text;
BEGIN
  IF NEW.checkin_date IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(a.timezone, ''), 'UTC')
  INTO v_timezone
  FROM public.accounts a
  WHERE a.id = NEW.account_id;

  NEW.checkin_date := (COALESCE(NEW.created_at, now()) AT TIME ZONE COALESCE(v_timezone, 'UTC'))::date;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_checkin_local_date ON public.checkins;
CREATE TRIGGER trg_set_checkin_local_date
  BEFORE INSERT OR UPDATE OF account_id, created_at, checkin_date
  ON public.checkins
  FOR EACH ROW EXECUTE FUNCTION public.set_checkin_local_date();

ALTER TABLE public.checkins
  ALTER COLUMN checkin_date SET NOT NULL;

DROP INDEX IF EXISTS public.checkins_account_day;
CREATE UNIQUE INDEX IF NOT EXISTS checkins_account_local_day
  ON public.checkins(account_id, checkin_date);
