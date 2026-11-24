import type { EngineStage } from '../../lib/invitationEngine';

/**
 * The Invitation Engine as one flow of four steps. The engine screen is the
 * hub: it shows the steps, where she is, and the next one as its main
 * button; each step screen says "Step N of 4" and goes back to the engine.
 * Pure (no React Native), so tests can import it.
 */
export const FLOW_STEPS = ['setup', 'kit', 'outcome', 'progress'] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];

export const FLOW_ROUTES: Readonly<Record<FlowStep, string>> = Object.freeze({
  setup: '/invitation-setup',
  kit: '/invitation-kit',
  outcome: '/invitation-outcome',
  progress: '/invitation-progress',
});

/** 1-based number of a step ("Step 2 of 4"). */
export function flowStepNumber(step: FlowStep): number {
  return FLOW_STEPS.indexOf(step) + 1;
}

export type FlowState = {
  /** The step she is on (highlighted), or none (only the map is done and the rest is for members). */
  current: FlowStep | null;
  /** Steps she has done at least once. */
  done: FlowStep[];
  /** Steps she can open from the list right now. */
  open: FlowStep[];
};

/**
 * Where she is in the flow. Null on the safety-first path: there the engine
 * shows safety, not invitation steps.
 * - map not finished (or the last alerts question left): Set up.
 * - map finished without membership: Set up done; the other steps stay shut
 *   (the paid screens are gated anyway).
 * - set up, nothing logged yet: Your kit.
 * - an invitation logged, or the engine paused (treatment, after a yes, back
 *   home, in recovery): Progress. Paused, the kit is not offered.
 */
export function invitationFlowState({
  stage,
  hasAttempt,
  paused,
}: {
  stage: EngineStage;
  hasAttempt: boolean;
  paused: boolean;
}): FlowState | null {
  switch (stage) {
    case 'safety':
      return null;
    case 'map':
    case 'finishSetup':
      return { current: 'setup', done: [], open: ['setup'] };
    case 'paywall':
      return { current: null, done: ['setup'], open: ['setup'] };
    case 'active':
    default:
      if (paused || hasAttempt) {
        return {
          current: 'progress',
          done: hasAttempt ? ['setup', 'kit', 'outcome'] : ['setup'],
          // Paused, the engine offers no invitation (its Prepare button is
          // hidden too); logging an update stays open, as on the paused card.
          open: paused ? ['setup', 'outcome', 'progress'] : [...FLOW_STEPS],
        };
      }
      return { current: 'kit', done: ['setup'], open: [...FLOW_STEPS] };
  }
}
