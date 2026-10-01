/**
 * Whether invitation content tied to the willingness window ("This is the
 * window… we can leave now") may be shown. It fails closed: anything other
 * than a freshly loaded, non-serious safety answer hides the invitation.
 */
export type SafetyGate = 'loading' | 'clear' | 'safety_first' | 'unknown';

export type SafetyLoadState = {
  status: 'loading' | 'ready' | 'error';
  /** The member's own loved_one_profiles.safety_concern ('' when no map yet). */
  safetyConcern: string | null;
};

export function safetyGateFrom(state: SafetyLoadState): SafetyGate {
  if (state.status === 'loading') return 'loading';
  if (state.status === 'error') return 'unknown';
  return state.safetyConcern === 'serious' ? 'safety_first' : 'clear';
}

/** Only a confirmed non-serious answer may show "say this / leave now". */
export function windowInviteAllowed(gate: SafetyGate): boolean {
  return gate === 'clear';
}
