-- Privacy-safe App Store review funnel. Events contain only the milestone and
-- app version; no check-in answers, notes, family details, or crisis content.

ALTER TABLE public.funnel_events DROP CONSTRAINT IF EXISTS funnel_events_stage_check;
ALTER TABLE public.funnel_events ADD CONSTRAINT funnel_events_stage_check
  CHECK (stage IN (
    'rsvp', 'attended', 'coaching_requested',
    'intervention_viewed', 'intervention_started',
    'brief_opened', 'brief_sent',
    'review_eligible', 'review_prompt_requested',
    'review_unavailable', 'review_manual_opened'
  ));

CREATE OR REPLACE FUNCTION public.log_funnel_event(
  p_stage text,
  p_metadata jsonb DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account uuid := public.my_account_id();
BEGIN
  IF v_account IS NULL THEN RETURN; END IF;
  IF p_stage NOT IN (
    'rsvp', 'attended', 'coaching_requested',
    'intervention_viewed', 'intervention_started',
    'brief_opened',
    'review_eligible', 'review_prompt_requested',
    'review_unavailable', 'review_manual_opened'
  ) THEN
    RAISE EXCEPTION 'bad_stage';
  END IF;

  INSERT INTO public.funnel_events (account_id, stage, metadata)
  VALUES (v_account, p_stage, coalesce(p_metadata, '{}'::jsonb));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_funnel_event(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_funnel_event(text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_prompt_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT jsonb_build_object(
    'eligible_events', count(*) FILTER (WHERE stage = 'review_eligible'),
    'prompt_requests', count(*) FILTER (WHERE stage = 'review_prompt_requested'),
    'prompted_accounts', count(DISTINCT account_id) FILTER (WHERE stage = 'review_prompt_requested'),
    'manual_opens', count(*) FILTER (WHERE stage = 'review_manual_opened'),
    'last_30_days', jsonb_build_object(
      'eligible', count(*) FILTER (
        WHERE stage = 'review_eligible' AND created_at >= now() - interval '30 days'
      ),
      'requested', count(*) FILTER (
        WHERE stage = 'review_prompt_requested' AND created_at >= now() - interval '30 days'
      ),
      'manual', count(*) FILTER (
        WHERE stage = 'review_manual_opened' AND created_at >= now() - interval '30 days'
      )
    )
  )
  INTO v_result
  FROM public.funnel_events
  WHERE stage IN (
    'review_eligible', 'review_prompt_requested',
    'review_unavailable', 'review_manual_opened'
  );

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_review_prompt_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_prompt_stats() TO authenticated;
