-- The "Treatment instead of jail" letter records tool_opened / tool_finished
-- like the other planners. log_funnel_event rejects names outside this
-- allowlist (bad_tool). Same list as 20261105100000 plus 'prosecutor_letter';
-- src/lib/toolUsageNames.ts mirrors it.
CREATE OR REPLACE FUNCTION public._usage_tools()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY[
    'boundaries', 'book_coaching', 'chat', 'crisis_mode', 'diy_planner', 'enabling_costs',
    'family_outcomes', 'finder', 'free_practice', 'guided_journey', 'holiday_plan', 'homecoming_week',
    'invitation_engine', 'learn', 'letter', 'membership_guide', 'personal_reminders',
    'plan_intervention', 'prosecutor_letter', 'rehearsal', 'safety_wallet', 'scripts', 'situation_brief',
    'support', 'tracker', 'trajectory', 'treatment_action_plan', 'visitation_plan'
  ]::text[];
$$;
REVOKE EXECUTE ON FUNCTION public._usage_tools() FROM PUBLIC, anon, authenticated;
