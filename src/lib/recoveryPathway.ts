export const RECOVERY_PHASES = [
  'active_use',
  'considering_treatment',
  'in_treatment',
  'returning_home',
  'early_recovery_30',
  'early_recovery_90',
  'ongoing_recovery',
  'return_to_use',
  'unsure',
] as const;

export type RecoveryPhase = (typeof RECOVERY_PHASES)[number];

const RECOVERY_PHASE_SET = new Set<string>(RECOVERY_PHASES);
const ACTIVE_USE_STATUSES = new Set(['using', 'escalating', 'crisis']);

export const RECOVERY_PHASE_ROUTE: Record<RecoveryPhase, string> = {
  active_use: '/safety-wallet',
  considering_treatment: '/finder',
  in_treatment: '/(tabs)/support',
  returning_home: '/safety-wallet',
  early_recovery_30: '/(tabs)/tracker',
  early_recovery_90: '/(tabs)/tracker',
  ongoing_recovery: '/(tabs)/support',
  return_to_use: '/crisis-mode',
  unsure: '/(tabs)/tracker',
};

/**
 * Maps both the original onboarding stages and the expanded family pathway to
 * one stable phase. Canonical user selections win over status so a stale
 * situation flag cannot silently undo an explicit update from the Today card.
 */
export function normalizeRecoveryPhase(
  stage: string | null | undefined,
  status: string | null | undefined,
): RecoveryPhase {
  if (stage && RECOVERY_PHASE_SET.has(stage)) return stage as RecoveryPhase;

  switch (stage) {
    case 'using':
      return 'active_use';
    case 'seeking_help':
      return 'considering_treatment';
    case 'recovery':
      return ACTIVE_USE_STATUSES.has(status ?? '') ? 'return_to_use' : 'early_recovery_30';
    case 'unsure':
      return 'unsure';
    default:
      break;
  }

  if (status === 'in_treatment') return 'in_treatment';
  if (ACTIVE_USE_STATUSES.has(status ?? '')) return 'active_use';
  return 'unsure';
}

/** A local-calendar rotation, unaffected by daylight-saving time changes. */
export function pathwayDaySlot(date: Date, variantCount = 3): number {
  if (!Number.isInteger(variantCount) || variantCount < 1) return 0;
  const localDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor(localDay / 86_400_000) % variantCount;
}
