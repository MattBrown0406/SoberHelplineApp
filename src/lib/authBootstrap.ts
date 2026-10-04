export type InitialLayoutState = 'stack' | 'bootstrap' | 'account-error';

export function isPushNavigationReady(input: {
  layoutState: InitialLayoutState;
  isAuthenticated: boolean;
  onboarded: boolean | null;
}): boolean {
  return input.layoutState === 'stack' && input.isAuthenticated && input.onboarded === true;
}

export function getInitialLayoutState(input: {
  isAuthenticated: boolean;
  isLoading: boolean;
  hasUser: boolean;
  onboardingReady: boolean;
  hasAccountError: boolean;
}): InitialLayoutState {
  if (input.isAuthenticated && input.hasAccountError && !input.hasUser) return 'account-error';
  if (
    input.isAuthenticated &&
    (input.isLoading || !input.hasUser || !input.onboardingReady)
  ) {
    return 'bootstrap';
  }
  return 'stack';
}

export class AccountRequestGate {
  private currentRequest = 0;

  begin(): number {
    this.currentRequest += 1;
    return this.currentRequest;
  }

  isCurrent(requestId: number): boolean {
    return requestId === this.currentRequest;
  }

  invalidate(): void {
    this.currentRequest += 1;
  }
}

export function resolveDirectAccountState(
  entitlementRows: Array<{ tier: string; expires_at: string | null }>,
  now = new Date(),
): 'direct-free' | 'direct-essential' | 'direct-premium' {
  const activeTiers = entitlementRows
    .filter((entitlement) => !entitlement.expires_at || new Date(entitlement.expires_at) >= now)
    .map((entitlement) => entitlement.tier);
  if (activeTiers.includes('premium')) return 'direct-premium';
  if (activeTiers.includes('essential')) return 'direct-essential';
  return 'direct-free';
}

export type DirectAccountState = 'direct-free' | 'direct-essential' | 'direct-premium';

const DIRECT_ACCOUNT_STATES: ReadonlySet<string> = new Set<DirectAccountState>([
  'direct-free', 'direct-essential', 'direct-premium',
]);

export function isDirectAccountState(value: unknown): value is DirectAccountState {
  return typeof value === 'string' && DIRECT_ACCOUNT_STATES.has(value);
}

/**
 * The tier to show after reading the entitlements table.
 *
 * A successful read is authoritative (`verified`). A failed or timed-out read
 * says nothing about the subscription, so it never downgrades: the member keeps
 * the tier this same account last had (in memory, or cached from its last
 * verified read), else free. Display only — server-side gates still read the
 * entitlements table — and an unverified result is never cached, so a stale
 * tier cannot outlive the next successful read.
 */
export function directStateAfterEntitlementRead(input: {
  rows: Array<{ tier: string; expires_at: string | null }> | null;
  lastKnownState: string | null | undefined;
  now?: Date;
}): { state: DirectAccountState; verified: boolean } {
  if (input.rows !== null) return { state: resolveDirectAccountState(input.rows, input.now), verified: true };
  return {
    state: isDirectAccountState(input.lastKnownState) ? input.lastKnownState : 'direct-free',
    verified: false,
  };
}

/**
 * The last tier known for `accountId`: the first candidate that is this same
 * account with a direct tier (pass the in-memory account before the cache).
 */
export function lastKnownDirectState(
  accountId: string,
  candidates: ReadonlyArray<{ id: string; accountState: string } | null | undefined>,
): DirectAccountState | null {
  for (const candidate of candidates) {
    if (candidate && candidate.id === accountId && isDirectAccountState(candidate.accountState)) {
      return candidate.accountState;
    }
  }
  return null;
}

/**
 * While the last entitlement read failed, the account is re-read after these
 * delays (and whenever the app returns to the foreground).
 */
export const ACCOUNT_READ_RETRY_DELAYS_MS: readonly number[] = Object.freeze([5_000, 15_000, 30_000, 60_000]);

/** The delay before retry number `attempt` (0-based), or null once the backoff is spent. */
export function accountReadRetryDelay(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 0) return null;
  return ACCOUNT_READ_RETRY_DELAYS_MS[attempt] ?? null;
}

export function resolveRefreshedDirectAccountState(input: {
  databaseRows: Array<{ tier: string; expires_at: string | null }> | null;
  previousState: 'direct-free' | 'direct-essential' | 'direct-premium';
  revenueCatTier: 'essential' | 'premium' | null;
  now?: Date;
}): 'direct-free' | 'direct-essential' | 'direct-premium' {
  if (input.databaseRows !== null) {
    return resolveDirectAccountState(input.databaseRows, input.now);
  }
  if (input.revenueCatTier === 'premium') return 'direct-premium';
  if (input.revenueCatTier === 'essential' && input.previousState === 'direct-free') {
    return 'direct-essential';
  }
  return input.previousState;
}

// A purchase the store just verified, honored for this app session while the
// server's entitlement mirror catches up (RevenueCat → sync-iap-entitlements).
// Display-only: server-side gates still read the entitlements table.
const VERIFIED_PURCHASE_GRACE_MS = 30 * 60 * 1000;
let verifiedPurchase: { accountId: string; tier: 'essential' | 'premium'; until: number } | null = null;

export function recordVerifiedPurchase(accountId: string, tier: 'essential' | 'premium', now = Date.now()): void {
  verifiedPurchase = { accountId, tier, until: now + VERIFIED_PURCHASE_GRACE_MS };
}

/** Never lets a lagging server read hide a purchase made moments ago. */
export function withVerifiedPurchase(
  accountId: string,
  state: 'direct-free' | 'direct-essential' | 'direct-premium',
  now = Date.now(),
): 'direct-free' | 'direct-essential' | 'direct-premium' {
  if (!verifiedPurchase || verifiedPurchase.accountId !== accountId || verifiedPurchase.until < now) return state;
  if (verifiedPurchase.tier === 'premium') return 'direct-premium';
  return state === 'direct-free' ? 'direct-essential' : state;
}

export async function withTimeoutFallback<T>(
  operation: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
