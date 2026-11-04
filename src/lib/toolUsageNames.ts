/**
 * Tool names for usage events (tool_opened / tool_finished). The server
 * allowlist (public._usage_tools()) must list exactly the same names.
 * Pure, so tests can import it.
 */
export const USAGE_TOOLS = [
  'boundaries', 'book_coaching', 'chat', 'crisis_mode', 'diy_planner', 'enabling_costs',
  'family_outcomes', 'finder', 'free_practice', 'guided_journey', 'holiday_plan', 'homecoming_week',
  'invitation_engine', 'learn', 'letter', 'membership_guide', 'personal_reminders',
  'plan_intervention', 'rehearsal', 'safety_wallet', 'scripts', 'situation_brief',
  'support', 'tracker', 'trajectory', 'treatment_action_plan', 'visitation_plan',
] as const;
export type UsageTool = typeof USAGE_TOOLS[number];

/** One event per tool, stage and UTC day (the server's dedupe day). */
export function toolUsageKey(tool: UsageTool, stage: 'opened' | 'finished', nowMs: number): string {
  return `${new Date(nowMs).toISOString().slice(0, 10)}:${stage}:${tool}`;
}
