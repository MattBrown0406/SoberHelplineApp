export type InitialLayoutState = 'stack' | 'bootstrap' | 'account-error';

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
