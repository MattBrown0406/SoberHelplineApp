-- Keep delivery validity separate from scheduled_for (which retries may move).
ALTER TABLE public.push_outbox ADD COLUMN expires_at timestamptz;

-- Legacy invitations have no trustworthy original local-day identity. Discard
-- them rather than granting the deployment backlog a new four-hour window.
UPDATE public.push_outbox
SET failed_at = now(), last_error = 'invitation_legacy_expiry_missing',
    processing_at = NULL, processing_token = NULL
WHERE kind = 'invitation_window' AND sent_at IS NULL AND failed_at IS NULL;

CREATE FUNCTION public._invitation_push_set_expiry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone text := public._invitation_account_tz(NEW.account_id);
  v_day date := (NEW.scheduled_for AT TIME ZONE v_zone)::date;
BEGIN
  -- Invoked at insertion, not retry: neither a retry nor a clock/timezone edit
  -- can move this deadline. Midnight also caps late-evening suggestions.
  NEW.expires_at := least(NEW.scheduled_for + interval '4 hours',
    (v_day + 1)::timestamp AT TIME ZONE v_zone);
  NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb)
    || jsonb_build_object('local_date', v_day);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._invitation_push_set_expiry() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER invitation_push_set_expiry
BEFORE INSERT ON public.push_outbox
FOR EACH ROW WHEN (NEW.kind = 'invitation_window')
EXECUTE FUNCTION public._invitation_push_set_expiry();

CREATE FUNCTION public.invitation_push_delivery_ttl(p_outbox_id uuid, p_processing_token uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.push_outbox%ROWTYPE;
  v_day date;
BEGIN
  SELECT * INTO v_row FROM public.push_outbox
  WHERE id = p_outbox_id AND kind = 'invitation_window'
    AND processing_token = p_processing_token
    AND sent_at IS NULL AND failed_at IS NULL;
  IF NOT FOUND OR v_row.expires_at IS NULL OR v_row.expires_at <= now()
    OR v_row.scheduled_for > now() THEN RETURN NULL; END IF;
  v_day := (now() AT TIME ZONE public._invitation_account_tz(v_row.account_id))::date;
  -- Compare strings instead of casting legacy/untrusted metadata to a date.
  IF (v_row.metadata ->> 'local_date') IS DISTINCT FROM v_day::text
    OR NOT EXISTS (
      SELECT 1 FROM public.invitation_engine_state
      WHERE account_id = v_row.account_id AND window_push_opt_in
        AND setup_completed_at IS NOT NULL
    ) OR NOT public._invitation_engine_allowed(v_row.account_id) THEN
    RETURN NULL;
  END IF;
  -- Do not reuse candidate selection: its cooldown intentionally excludes the
  -- already enqueued row. Recheck only current consent/access/safety/outcomes.
  IF public._invitation_window_blocked(
    public._invitation_snapshot(v_row.account_id, v_day), v_day) IS NOT NULL THEN
    RETURN NULL;
  END IF;
  RETURN greatest(0, least(14400, floor(extract(epoch FROM (v_row.expires_at - now())))::integer));
END;
$$;
REVOKE ALL ON FUNCTION public.invitation_push_delivery_ttl(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invitation_push_delivery_ttl(uuid, uuid) TO service_role;

CREATE FUNCTION public._cancel_withdrawn_invitation_pushes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Clear leases as well: a worker holding a pre-withdrawal claim must fail
  -- the delivery RPC's token check, even if the member later opts back in.
  UPDATE public.push_outbox
  SET failed_at = now(), last_error = 'invitation_withdrawn',
      processing_at = NULL, processing_token = NULL
  WHERE account_id = NEW.account_id AND kind = 'invitation_window'
    AND sent_at IS NULL AND failed_at IS NULL;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._cancel_withdrawn_invitation_pushes() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER invitation_push_consent_withdrawn
AFTER INSERT OR UPDATE ON public.invitation_engine_state
FOR EACH ROW WHEN (NOT NEW.window_push_opt_in OR NEW.setup_completed_at IS NULL)
EXECUTE FUNCTION public._cancel_withdrawn_invitation_pushes();
CREATE TRIGGER invitation_push_safety_withdrawn
AFTER INSERT OR UPDATE ON public.loved_one_profiles
FOR EACH ROW WHEN (NEW.safety_concern = 'serious' OR NEW.completed_at IS NULL)
EXECUTE FUNCTION public._cancel_withdrawn_invitation_pushes();

-- Departure must use leave_family_space(), which transfers created_by/owner
-- and withdraws shared logs. Its SECURITY DEFINER rights and the trusted
-- service-role cleanup paths are preserved; no unrelated table rights change.
REVOKE DELETE ON public.family_members FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "family_members: self delete" ON public.family_members;
GRANT DELETE ON public.family_members TO service_role;
