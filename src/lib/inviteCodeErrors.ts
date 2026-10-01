// Distinguish why a family-space or provider invite code was refused, so the
// screens stop reporting rate limits and existing memberships as "invalid code".

type RpcError = { code?: string | null; message?: string | null } | null | undefined;

export type FamilyJoinFailure = 'invalid_code' | 'too_many_attempts' | 'already_in_family_space' | 'error';
export type FamilyJoinResult = { ok: true } | { ok: false; reason: FamilyJoinFailure };

export type ProviderCodeFailure = 'invalid_code' | 'too_many_attempts' | 'error';

function matches(error: RpcError, sqlState: string, message: string): boolean {
  return error?.code === sqlState || (typeof error?.message === 'string' && error.message.includes(message));
}

/** join_family_space: NULL = unknown code; 54000 rate limit; 23505 already in another space. */
export function familyJoinFailure(error: RpcError, spaceId: unknown): FamilyJoinFailure | null {
  if (!error) return typeof spaceId === 'string' && spaceId ? null : 'invalid_code';
  if (matches(error, '54000', 'too_many_attempts')) return 'too_many_attempts';
  if (matches(error, '23505', 'already_in_family_space')) return 'already_in_family_space';
  if (matches(error, '22023', 'invalid_invite_code')) return 'invalid_code';
  return 'error';
}

/** redeem_invite_code: NULL = no active provider code; 54000 rate limit. */
export function providerCodeFailure(error: RpcError, orgName: unknown): ProviderCodeFailure | null {
  if (!error) return typeof orgName === 'string' && orgName ? null : 'invalid_code';
  if (matches(error, '54000', 'too_many_attempts')) return 'too_many_attempts';
  return 'error';
}

/** alignment namespace key for a failed family join. */
export function familyJoinErrorKey(reason: FamilyJoinFailure): string {
  switch (reason) {
    case 'too_many_attempts': return 'joinErrorTooManyAttempts';
    case 'already_in_family_space': return 'joinErrorAlreadyInFamily';
    case 'error': return 'joinErrorNetwork';
    default: return 'joinError';
  }
}

/** onboarding namespace key for a failed provider code. */
export function providerCodeErrorKey(reason: ProviderCodeFailure): string {
  switch (reason) {
    case 'too_many_attempts': return 'invite.errorTooManyAttempts';
    case 'error': return 'invite.errorNetwork';
    default: return 'invite.errorInvalid';
  }
}

/** Accounts paying through the App Store / Google Play keep being billed after joining a provider. */
export function hasOwnStoreSubscription(accountState: string | null | undefined): boolean {
  return accountState === 'direct-essential' || accountState === 'direct-premium';
}
