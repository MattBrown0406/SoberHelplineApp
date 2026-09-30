-- =============================================================================
-- Server-side daily caps for the AI practice partner (rehearsal-partner).
--
-- The 12-turn session cap lived only in the app, so any entitled account (or a
-- leaked token) could loop the Edge Function and run up unbounded LLM, Whisper
-- and ElevenLabs cost. The function now calls consume_rehearsal_quota() before
-- every paid upstream call. Caps are generous for real practice (~16 full
-- sessions a day) and bound abuse.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.rehearsal_usage (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  mode       text NOT NULL CHECK (mode IN ('reply', 'stt', 'debrief')),
  count      integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (account_id, usage_date, mode)
);

ALTER TABLE public.rehearsal_usage ENABLE ROW LEVEL SECURITY;
-- Service-only bookkeeping: members never read or write it directly.
REVOKE ALL ON public.rehearsal_usage FROM anon, authenticated;

-- Consumes one unit of today's (UTC) quota for the calling member. Returns
-- false once the cap is exhausted. Callable only by signed-in members; it can
-- only ever spend the caller's own quota.
CREATE OR REPLACE FUNCTION public.consume_rehearsal_quota(p_mode text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := public.my_account_id();
  v_limit   integer;
  v_count   integer;
BEGIN
  IF v_account IS NULL THEN
    RETURN false;
  END IF;

  v_limit := CASE p_mode
    WHEN 'reply'   THEN 200
    WHEN 'stt'     THEN 200
    WHEN 'debrief' THEN 30
    ELSE NULL
  END;
  IF v_limit IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.rehearsal_usage (account_id, usage_date, mode, count)
  VALUES (v_account, (now() AT TIME ZONE 'utc')::date, p_mode, 1)
  ON CONFLICT (account_id, usage_date, mode)
    DO UPDATE SET count = public.rehearsal_usage.count + 1
  RETURNING count INTO v_count;

  RETURN v_count <= v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_rehearsal_quota(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_rehearsal_quota(text) TO authenticated, service_role;
