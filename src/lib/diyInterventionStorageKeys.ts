const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Schema-v1/v2 parts retained for non-destructive legacy reads. */
export const DIY_PROTECTED_PARTS = [
  'core', 'team', 'team_extra', 'unity', 'rehearsal', 'letter_love', 'letter_facts', 'letter_request', 'letter_boundary', 'letter_complete',
] as const;
export type DiyProtectedPart = typeof DIY_PROTECTED_PARTS[number];

/** Schema-v3 parts stored in recoverable double-buffered slots. */
export const DIY_CURRENT_PROTECTED_PARTS = [
  'core', 'team', 'team_extra', 'unity', 'unity_extra', 'rehearsal',
  'letter_love', 'letter_love_extra', 'letter_facts', 'letter_facts_extra',
  'letter_request', 'letter_request_extra', 'letter_boundary', 'letter_boundary_extra',
  'letter_complete', 'letter_complete_extra',
] as const;
export type DiyCurrentProtectedPart = typeof DIY_CURRENT_PROTECTED_PARTS[number];
export type DiyProtectedSlot = 'a' | 'b';

function requireAccountId(accountId: string): void {
  if (!UUID_PATTERN.test(accountId)) throw new Error('invalid_diy_account_id');
}

export function diyInterventionStorageKey(accountId: string, part: DiyProtectedPart): string {
  requireAccountId(accountId);
  return `soberhelpline.diy_intervention.${accountId}.${part}`;
}

export function diyInterventionSlotStorageKey(
  accountId: string,
  slot: DiyProtectedSlot,
  part: DiyCurrentProtectedPart,
): string {
  requireAccountId(accountId);
  return `soberhelpline.diy_intervention.${accountId}.${slot}.${part}`;
}

export function diyInterventionCommitStorageKey(accountId: string): string {
  requireAccountId(accountId);
  return `soberhelpline.diy_intervention.${accountId}.committed_slot`;
}
