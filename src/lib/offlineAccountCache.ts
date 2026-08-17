import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AccountState, AuthUser, Entitlements } from '../api/types';
import { entitlementsForAccountState } from './featureAccess';

const CACHE_PREFIX = '@sober-helpline/offline-account/v1';
const LAST_PRINCIPAL_KEY = `${CACHE_PREFIX}:last-principal`;
const ACCOUNT_STATES: ReadonlySet<string> = new Set<AccountState>([
  'attached', 'direct-free', 'direct-essential', 'direct-premium',
]);

export interface AccountCacheStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

type CachedAccount = {
  version: 1;
  authUserId: string;
  account: AuthUser;
};

function keyFor(authUserId: string): string {
  return `${CACHE_PREFIX}:${authUserId}`;
}

function isEntitlements(value: unknown): value is Entitlements {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return [
    'canMessageOnCallCoach', 'canCallCoach', 'canAccessPrivateVideo',
    'canCallAfterHours', 'canAccessGroups', 'canAccessLearningContent',
    'hasAssignedCoach', 'canAccessTracker', 'canAccessFullToday',
    'canAccessAiRehearsal', 'canAccessDiyIntervention', 'canUsePracticePush',
    'canAccessCrisisCommandPlan', 'canAccessPlanReview', 'hasIncludedPlanReview',
  ].every((key) => typeof record[key] === 'boolean');
}

export function isValidCachedAuthUser(value: unknown): value is AuthUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Record<string, unknown>;
  return typeof user.id === 'string' && user.id.length > 0
    && typeof user.firstName === 'string'
    && typeof user.lastName === 'string'
    && typeof user.email === 'string'
    && (user.avatarUrl === null || typeof user.avatarUrl === 'string')
    && typeof user.accountState === 'string' && ACCOUNT_STATES.has(user.accountState)
    && isEntitlements(user.entitlements)
    && (user.orgId === null || typeof user.orgId === 'string')
    && (user.branding === null || typeof user.branding === 'object')
    && typeof user.joinedAt === 'string'
    && typeof user.timezone === 'string';
}

export async function cacheSuccessfulAccount(
  authUserId: string,
  account: AuthUser,
  storage: AccountCacheStorage = AsyncStorage,
): Promise<void> {
  if (!authUserId || !isValidCachedAuthUser(account)) return;
  const entry: CachedAccount = { version: 1, authUserId, account };
  await storage.setItem(keyFor(authUserId), JSON.stringify(entry));
  await storage.setItem(LAST_PRINCIPAL_KEY, authUserId);
}

export async function restoreOfflineAccount(
  authUserId: string,
  storage: AccountCacheStorage = AsyncStorage,
): Promise<AuthUser | null> {
  if (!authUserId) return null;
  try {
    const raw = await storage.getItem(keyFor(authUserId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<CachedAccount>;
    // Match the persisted Supabase principal, not email and not the account row
    // id (which is intentionally preserved for account-scoped database calls).
    if (entry.version !== 1 || entry.authUserId !== authUserId || !isValidCachedAuthUser(entry.account)) {
      return null;
    }
    // This cache exists so bundled crisis/readiness content can open without a
    // radio. It is not an offline subscription authority: a revoked or expired
    // paid/admin capability must never survive merely because the device stayed
    // offline. Restore identity/profile data, but fail closed to the free
    // entitlement baseline until the server is reachable again.
    return {
      ...entry.account,
      // Cached email can unlock QA/admin-only routes elsewhere. Preserve the
      // profile, but do not treat stale email as fresh admin authority.
      email: '',
      accountState: 'direct-free',
      entitlements: entitlementsForAccountState('direct-free'),
    };
  } catch {
    return null;
  }
}

export async function restoreLastOfflineAccount(
  storage: AccountCacheStorage = AsyncStorage,
): Promise<AuthUser | null> {
  try {
    const authUserId = await storage.getItem(LAST_PRINCIPAL_KEY);
    return authUserId ? restoreOfflineAccount(authUserId, storage) : null;
  } catch {
    return null;
  }
}

export async function clearOfflineAccount(
  authUserId: string,
  storage: AccountCacheStorage = AsyncStorage,
): Promise<void> {
  if (!authUserId) return;
  await storage.removeItem(keyFor(authUserId));
  if (await storage.getItem(LAST_PRINCIPAL_KEY) === authUserId) {
    await storage.removeItem(LAST_PRINCIPAL_KEY);
  }
}

export async function clearLastOfflineAccount(
  storage: AccountCacheStorage = AsyncStorage,
): Promise<void> {
  const authUserId = await storage.getItem(LAST_PRINCIPAL_KEY);
  if (authUserId) await storage.removeItem(keyFor(authUserId));
  await storage.removeItem(LAST_PRINCIPAL_KEY);
}

export function isOfflineFallbackError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '').toLowerCase()
    : '';
  const message = error instanceof Error
    ? error.message.toLowerCase()
    : typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message ?? '').toLowerCase()
      : '';
  if (code === 'pgrst116' || message.includes('account_not_found')) return false;
  if (message === 'account_load_timeout') return true;
  return ['network', 'fetch failed', 'failed to fetch', 'connection', 'offline', 'timed out', 'timeout']
    .some((fragment) => message.includes(fragment));
}