/**
 * Tool names for usage events (tool_opened / tool_finished). The server
 * allowlist (public._usage_tools()) must list exactly the same names.
 * Pure, so tests can import it.
 */
export const USAGE_TOOLS = [
  'book_coaching', 'boundaries', 'chat', 'choose_treatment', 'crisis_mode', 'diy_planner',
  'enabling_costs', 'family_outcomes', 'fellowship_finder', 'finder', 'finder_detail', 'free_practice',
  'guided_journey', 'holiday_plan', 'homecoming_week', 'invitation_engine', 'invitation_kit',
  'invitation_outcome', 'invitation_progress', 'invitation_setup', 'learn', 'letter', 'live_room',
  'membership_guide', 'personal_reminders', 'plan_intervention', 'plans', 'prosecutor_letter',
  'rehearsal', 'rehearsal_history', 'safety_wallet', 'scripts', 'settings', 'situation_brief',
  'support', 'today', 'tracker', 'trajectory', 'treatment_action_plan', 'video_session',
  'visitation_plan',
] as const;
export type UsageTool = typeof USAGE_TOOLS[number];

/** One event per tool, stage and UTC day (the server's dedupe day). */
export function toolUsageKey(tool: UsageTool, stage: 'opened' | 'finished', nowMs: number): string {
  return `${new Date(nowMs).toISOString().slice(0, 10)}:${stage}:${tool}`;
}
