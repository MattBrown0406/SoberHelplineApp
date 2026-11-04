-- Which tools families actually use. Many tools keep their content on the
-- device (Safety Wallet, the planners, letters in progress), so nothing on the
-- server showed whether anyone opens them. Two funnel stages record that a
-- tool was opened or finished: the tool's name and nothing else, at most once
-- per member, tool and day. admin_tool_usage() summarizes them for Admin.

ALTER TABLE public.funnel_events DROP CONSTRAINT IF EXISTS funnel_events_stage_check;
ALTER TABLE public.funnel_events ADD CONSTRAINT funnel_events_stage_check
  CHECK (stage IN (
    'rsvp', 'attended', 'coaching_requested',
    'intervention_viewed', 'intervention_started',
    'brief_opened', 'brief_sent',
    'review_eligible', 'review_prompt_requested',
    'review_unavailable', 'review_manual_opened',
    'monday_call_share_requested', 'boundary_card_print_requested',
    'tool_opened', 'tool_finished'
  ));

CREATE OR REPLACE FUNCTION public._usage_tools()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY[
    'boundaries', 'book_coaching', 'chat', 'crisis_mode', 'diy_planner', 'enabling_costs',
    'family_outcomes', 'finder', 'free_practice', 'guided_journey', 'homecoming_week',
    'invitation_engine', 'learn', 'letter', 'membership_guide', 'personal_reminders',
    'plan_intervention', 'rehearsal', 'safety_wallet', 'scripts', 'situation_brief',
    'support', 'tracker', 'trajectory', 'treatment_action_plan', 'visitation_plan'
  ]::text[];
$$;
REVOKE EXECUTE ON FUNCTION public._usage_tools() FROM PUBLIC, anon, authenticated;

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
  v_tool text;
BEGIN
  IF v_account IS NULL THEN RETURN; END IF;
  IF p_stage NOT IN (
    'rsvp', 'attended', 'coaching_requested',
    'intervention_viewed', 'intervention_started',
    'brief_opened',
    'review_eligible', 'review_prompt_requested',
    'review_unavailable', 'review_manual_opened',
    'monday_call_share_requested', 'boundary_card_print_requested',
    'tool_opened', 'tool_finished'
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
  ELSIF p_stage IN ('tool_opened', 'tool_finished') THEN
    -- Only an allowlisted tool name is kept; once per member, tool and day.
    v_tool := p_metadata ->> 'tool';
    IF v_tool IS NULL OR NOT (v_tool = ANY (public._usage_tools())) THEN
      RAISE EXCEPTION 'bad_tool';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.funnel_events e
      WHERE e.account_id = v_account AND e.stage = p_stage AND e.metadata ->> 'tool' = v_tool
        AND e.created_at >= date_trunc('day', now())
    ) THEN
      RETURN;
    END IF;
    v_metadata := jsonb_build_object('tool', v_tool);
  ELSE
    v_metadata := coalesce(p_metadata, '{}'::jsonb);
  END IF;

  INSERT INTO public.funnel_events (account_id, stage, metadata)
  VALUES (v_account, p_stage, v_metadata);
END;
$$;
REVOKE ALL ON FUNCTION public.log_funnel_event(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_funnel_event(text, jsonb) TO authenticated;

-- Per tool over the last p_days days: members who opened it, members who
-- finished it, and member-days opened. Admins only.
CREATE OR REPLACE FUNCTION public.admin_tool_usage(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_result jsonb;
BEGIN
  IF NOT public.is_admin_jwt() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'tool', x.tool,
      'members_opened', x.members_opened,
      'members_finished', x.members_finished,
      'days_opened', x.days_opened
    ) ORDER BY x.members_opened DESC, x.members_finished DESC, x.tool), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT t.tool,
      count(DISTINCT e.account_id) FILTER (WHERE e.stage = 'tool_opened') AS members_opened,
      count(DISTINCT e.account_id) FILTER (WHERE e.stage = 'tool_finished') AS members_finished,
      count(*) FILTER (WHERE e.stage = 'tool_opened') AS days_opened
    FROM unnest(public._usage_tools()) AS t(tool)
    LEFT JOIN public.funnel_events e
      ON e.metadata ->> 'tool' = t.tool
     AND e.stage IN ('tool_opened', 'tool_finished')
     AND e.created_at >= now() - make_interval(days => v_days)
    GROUP BY t.tool
  ) x;

  RETURN jsonb_build_object('days', v_days, 'tools', v_result);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_tool_usage(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_tool_usage(integer) TO authenticated;
