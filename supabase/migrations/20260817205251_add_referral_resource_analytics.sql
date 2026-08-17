-- Privacy-safe distribution analytics for public recovery resources.
-- Events record only resource type and language; no family, check-in, boundary,
-- loved-one, or crisis content is included.

ALTER TABLE public.funnel_events DROP CONSTRAINT IF EXISTS funnel_events_stage_check;
ALTER TABLE public.funnel_events ADD CONSTRAINT funnel_events_stage_check
  CHECK (stage IN (
    'rsvp', 'attended', 'coaching_requested',
    'intervention_viewed', 'intervention_started',
    'brief_opened', 'brief_sent',
    'review_eligible', 'review_prompt_requested',
    'review_unavailable', 'review_manual_opened',
    'monday_call_share_requested', 'boundary_card_print_requested'
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
  v_metadata jsonb;
BEGIN
  IF v_account IS NULL THEN RETURN; END IF;
  IF p_stage NOT IN (
    'rsvp', 'attended', 'coaching_requested',
    'intervention_viewed', 'intervention_started',
    'brief_opened',
    'review_eligible', 'review_prompt_requested',
    'review_unavailable', 'review_manual_opened',
    'monday_call_share_requested', 'boundary_card_print_requested'
  ) THEN
    RAISE EXCEPTION 'bad_stage';
  END IF;

  -- Distribution telemetry is deliberately data-minimized at the database
  -- boundary. A modified client cannot attach family or recovery content.
  IF p_stage IN ('monday_call_share_requested', 'boundary_card_print_requested') THEN
    v_metadata := jsonb_build_object(
      'language', CASE
        WHEN p_metadata ->> 'language' IN ('en', 'es') THEN p_metadata ->> 'language'
        ELSE 'unknown'
      END
    );
  ELSE
    v_metadata := coalesce(p_metadata, '{}'::jsonb);
  END IF;

  INSERT INTO public.funnel_events (account_id, stage, metadata)
  VALUES (v_account, p_stage, v_metadata);
END;
$$;

REVOKE ALL ON FUNCTION public.log_funnel_event(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_funnel_event(text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_referral_resource_stats()
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
    'monday_call_share_requests', count(*) FILTER (WHERE stage = 'monday_call_share_requested'),
    'boundary_print_requests', count(*) FILTER (WHERE stage = 'boundary_card_print_requested'),
    'distribution_accounts', count(DISTINCT account_id) FILTER (
      WHERE stage IN ('monday_call_share_requested', 'boundary_card_print_requested')
    ),
    'last_30_days', jsonb_build_object(
      'monday_call_share_requests', count(*) FILTER (
        WHERE stage = 'monday_call_share_requested' AND created_at >= now() - interval '30 days'
      ),
      'boundary_print_requests', count(*) FILTER (
        WHERE stage = 'boundary_card_print_requested' AND created_at >= now() - interval '30 days'
      )
    )
  )
  INTO v_result
  FROM public.funnel_events
  WHERE stage IN ('monday_call_share_requested', 'boundary_card_print_requested');

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_referral_resource_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_referral_resource_stats() TO authenticated;
