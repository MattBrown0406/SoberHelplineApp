-- App 4.4: complete open-counts, so Admin shows which screens are used.
-- log_funnel_event rejects tool names outside this allowlist (bad_tool). Same list as
-- 20261105110000 plus the screens that had no count yet: 'today', 'settings', 'plans',
-- 'rehearsal_history', 'finder_detail', 'video_session', 'live_room', and the four invitation
-- screens 'invitation_setup', 'invitation_kit', 'invitation_progress', 'invitation_outcome',
-- and 'fellowship_finder' (Today's check-in card opened a family meeting finder: only that,
-- never which fellowship). Nothing else changes; admin_tool_usage() lists every name here.
-- src/lib/toolUsageNames.ts mirrors it.
CREATE OR REPLACE FUNCTION public._usage_tools()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY[
    'book_coaching', 'boundaries', 'chat', 'choose_treatment', 'crisis_mode', 'diy_planner',
    'enabling_costs', 'family_outcomes', 'fellowship_finder', 'finder', 'finder_detail', 'free_practice',
    'guided_journey', 'holiday_plan', 'homecoming_week', 'invitation_engine', 'invitation_kit',
    'invitation_outcome', 'invitation_progress', 'invitation_setup', 'learn', 'letter', 'live_room',
    'membership_guide', 'personal_reminders', 'plan_intervention', 'plans', 'prosecutor_letter',
    'rehearsal', 'rehearsal_history', 'safety_wallet', 'scripts', 'settings', 'situation_brief',
    'support', 'today', 'tracker', 'trajectory', 'treatment_action_plan', 'video_session',
    'visitation_plan'
  ]::text[];
$$;
REVOKE EXECUTE ON FUNCTION public._usage_tools() FROM PUBLIC, anon, authenticated;
