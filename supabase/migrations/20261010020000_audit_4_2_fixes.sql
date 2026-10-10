-- =====================================================================
-- Pre-4.2 audit fixes. Re-runnable.
--
-- 1. Spanish members no longer get The Family Squares reminders from the app
--    (20261010010000). The website was still told the app reminds them
--    (family-squares-push-reachable / web sync "app_reminders"), so it skipped
--    its own email and they got neither. The app now claims only members it
--    actually reminds.
-- 2. message_reactions: the FOR ALL policy let a member insert or move a
--    reaction onto any message id. All writes go through toggle_reaction
--    (SECURITY DEFINER, thread-checked); members keep read + delete-own.
-- 3. messages.created_at is set by the server: a crafted client could backdate
--    a message below the admin's last-read mark (never shown as unread) or
--    future-date it to pin the thread.
-- 4. The Tuesday reset kept next week's La Sobremesa links but dropped the
--    RSVPs of members who reserved Monday night after the call, so they got no
--    reminder. Keep RSVPs that hold a link for an upcoming call.
-- 5. Practice voice: its own daily cap ('voice', 60/day). One member could
--    otherwise spend ~180k ElevenLabs characters a day under the reply cap,
--    and when the account runs out voice silently stops for everyone.
-- =====================================================================

-- 1 ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._app_reminds_family_call(p_push_token text, p_seen_at timestamptz, p_reminders boolean)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT nullif(btrim(coalesce(p_push_token, '')), '') IS NOT NULL
     AND p_seen_at IS NOT NULL
     AND p_seen_at > now() - interval '30 days'
     AND coalesce(p_reminders, false)
$$;
REVOKE ALL ON FUNCTION public._app_reminds_family_call(text, timestamptz, boolean) FROM PUBLIC, anon, authenticated;

-- Same rule plus the locale the dispatcher now checks. Used by both bridge RPCs.
CREATE OR REPLACE FUNCTION public._app_reminds_family_call(
  p_push_token text, p_seen_at timestamptz, p_reminders boolean, p_locale text
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT public._app_reminds_family_call(p_push_token, p_seen_at, p_reminders)
     AND coalesce(p_locale, 'en') NOT LIKE 'es%'
$$;
REVOKE ALL ON FUNCTION public._app_reminds_family_call(text, timestamptz, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._app_reminds_family_call(text, timestamptz, boolean, text) TO service_role;

-- Re-point the two bridge RPCs at the locale-aware rule, keeping their bodies.
DO $$
DECLARE
  v_name text;
  v_def text;
  v_new text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY['service_family_squares_attendees', 'service_family_squares_push_reachable'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname = v_name
    LIMIT 1;
    IF v_def IS NULL THEN
      RAISE EXCEPTION 'function % not found', v_name;
    END IF;
    IF v_def ~ '_app_reminds_family_call\([^)]*locale' THEN
      CONTINUE; -- already locale-aware
    END IF;
    -- Every call passes (push_token, last_seen_at, family_call_reminders) of an
    -- accounts row; add that row's locale as the 4th argument.
    v_new := regexp_replace(
      v_def,
      '_app_reminds_family_call\(\s*([a-z_]+)\.push_token\s*,\s*([^,]+?)\s*,\s*([^)]+?)\s*\)',
      '_app_reminds_family_call(\1.push_token, \2, \3, \1.locale)',
      'g'
    );
    IF v_new = v_def THEN
      RAISE EXCEPTION 'could not rewrite % (unexpected call shape)', v_name;
    END IF;
    EXECUTE v_new;
  END LOOP;
END $$;

-- 2 ------------------------------------------------------------------
DROP POLICY IF EXISTS "own_reactions" ON public.message_reactions;
DROP POLICY IF EXISTS "own_reactions_delete" ON public.message_reactions;
CREATE POLICY "own_reactions_delete" ON public.message_reactions
  FOR DELETE
  USING (account_id = (SELECT id FROM public.accounts WHERE user_id = auth.uid()));
REVOKE INSERT, UPDATE ON TABLE public.message_reactions FROM anon, authenticated;

-- 3 ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._messages_server_created_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Rows written through the API by app users always carry the server's time;
  -- service-role writers (functions, imports) keep what they set.
  IF coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') IN ('authenticated', 'anon') THEN
    NEW.created_at := now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._messages_server_created_at() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS messages_server_created_at ON public.messages;
CREATE TRIGGER messages_server_created_at
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public._messages_server_created_at();

-- 4 ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_family_squares_weekly_rsvps()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local_now timestamp := clock_timestamp() AT TIME ZONE 'America/Los_Angeles';
  v_deleted integer := 0;
  v_more integer := 0;
  v_links integer := 0;
BEGIN
  -- pg_cron runs in UTC. The job runs at both possible UTC offsets and this
  -- guard makes exactly the 2 AM Pacific invocation perform the reset.
  IF extract(isodow FROM v_local_now) <> 2 OR extract(hour FROM v_local_now) <> 2 THEN
    RETURN 0;
  END IF;

  DELETE FROM public.session_rsvps
  WHERE session_id = public.family_squares_session_id();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- La Sobremesa: keep members who already reserved next week's call.
  DELETE FROM public.session_rsvps r
  WHERE r.session_id = public.la_sobremesa_session_id()
    AND NOT EXISTS (
      SELECT 1 FROM public.session_join_links l
      WHERE l.session_id = r.session_id AND l.account_id = r.account_id
        AND l.starts_at > clock_timestamp()
    );
  GET DIAGNOSTICS v_more = ROW_COUNT;

  DELETE FROM public.session_join_links WHERE starts_at < clock_timestamp();
  GET DIAGNOSTICS v_links = ROW_COUNT;
  RETURN v_deleted + v_more + v_links;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reset_family_squares_weekly_rsvps() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_family_squares_weekly_rsvps() TO service_role;

-- 5 ------------------------------------------------------------------
ALTER TABLE public.rehearsal_usage DROP CONSTRAINT IF EXISTS rehearsal_usage_mode_check;
ALTER TABLE public.rehearsal_usage
  ADD CONSTRAINT rehearsal_usage_mode_check
  CHECK (mode IN ('reply', 'stt', 'debrief', 'whisper', 'invitation', 'voice'));

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
    WHEN 'reply'      THEN 200
    WHEN 'stt'        THEN 200
    WHEN 'debrief'    THEN 30
    WHEN 'whisper'    THEN 200
    WHEN 'invitation' THEN 30
    -- Voiced replies (ElevenLabs, up to 900 characters each). Past this the
    -- practice partner keeps answering in text.
    WHEN 'voice'      THEN 60
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
