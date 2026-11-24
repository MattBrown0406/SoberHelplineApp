import type { RecoveryPhase } from './recoveryPathway';
import type { SituationBand } from './situation';

/**
 * Which tools the Tools tab shows first ("For where you are now"), from where
 * her loved one is (the recovery phase she set on Today) and how things are
 * right now (the situation band). Pure, so tests can import it.
 *
 * Every tool stays reachable: the ones not picked are listed, in the usual
 * order, under "All tools".
 */

/** Every tool card on the Tools tab, in the tab's usual order. */
export const TOOL_IDS = [
  'invitation',
  'actionPlan',
  'diy',
  'homecoming',
  'visitation',
  'holiday',
  'prosecutor',
  'choose',
  'costs',
  'safety',
] as const;

export type ToolId = (typeof TOOL_IDS)[number];

/** At most this many tools are picked for her. */
export const FOR_NOW_MAX = 3;

/**
 * The tools that fit each phase, most useful first. The DIY intervention
 * planner and the prosecutor letter are specialised, so they stay under
 * "All tools" (the arrest flow in crisis mode links the letter directly).
 */
export const PHASE_TOOLS: Readonly<Record<RecoveryPhase, readonly ToolId[]>> = Object.freeze({
  active_use: ['invitation', 'safety', 'costs'],
  unsure: ['invitation', 'safety', 'costs'],
  considering_treatment: ['choose', 'actionPlan', 'invitation'],
  in_treatment: ['visitation', 'holiday', 'actionPlan'],
  returning_home: ['homecoming', 'holiday', 'safety'],
  early_recovery_30: ['homecoming', 'holiday', 'safety'],
  early_recovery_90: ['holiday', 'homecoming'],
  ongoing_recovery: ['holiday', 'homecoming'],
  return_to_use: ['safety', 'invitation'],
});

export type ToolsForPhase = {
  /** "For where you are now": two or three tools, in the order that fits. */
  forNow: ToolId[];
  /** "All tools": every other tool, in the tab's usual order. */
  others: ToolId[];
};

/**
 * The tools for where she is now, and the rest.
 * - No phase known: the tab's usual first three.
 * - An elevated or crisis band puts the Safety Wallet first (added if the
 *   phase did not pick it, keeping at most three).
 */
export function toolsForPhase(phase: RecoveryPhase | null | undefined, band: SituationBand | null | undefined): ToolsForPhase {
  const picked: ToolId[] = phase && PHASE_TOOLS[phase]
    ? [...PHASE_TOOLS[phase]]
    : TOOL_IDS.slice(0, FOR_NOW_MAX);
  let forNow = picked;
  if (band === 'elevated' || band === 'crisis') {
    forNow = ['safety', ...picked.filter((tool) => tool !== 'safety')];
  }
  forNow = forNow.slice(0, FOR_NOW_MAX);
  const chosen = new Set<ToolId>(forNow);
  return { forNow, others: TOOL_IDS.filter((tool) => !chosen.has(tool)) };
}
