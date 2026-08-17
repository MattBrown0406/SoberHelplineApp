import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AuthUser } from '../src/api/types';
import { entitlementsForAccountState } from '../src/lib/featureAccess';
import {
  cacheSuccessfulAccount,
  clearLastOfflineAccount,
  clearOfflineAccount,
  isOfflineFallbackError,
  restoreLastOfflineAccount,
  restoreOfflineAccount,
  type AccountCacheStorage,
} from '../src/lib/offlineAccountCache';

class MemoryStorage implements AccountCacheStorage {
  values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
}

function account(id = 'database-account-42'): AuthUser {
  return {
    id,
    firstName: 'Test',
    lastName: 'Member',
    email: 'member@example.com',
    avatarUrl: null,
    accountState: 'direct-essential',
    entitlements: entitlementsForAccountState('direct-essential'),
    orgId: 'org-9',
    branding: null,
    joinedAt: '2026-01-02T03:04:05.000Z',
    timezone: 'America/Los_Angeles',
  };
}

test('cache restores only the exact identity and drops stale paid access', async () => {
  const storage = new MemoryStorage();
  await cacheSuccessfulAccount('supabase-user-a', account(), storage);
  const restored = await restoreOfflineAccount('supabase-user-a', storage);
  assert.equal(restored?.id, 'database-account-42');
  assert.equal(restored?.accountState, 'direct-free');
  assert.equal(restored?.email, '');
  assert.equal(restored?.entitlements.canAccessFullToday, false);
  assert.equal(restored?.entitlements.canAccessTracker, true);
  assert.equal(await restoreOfflineAccount('supabase-user-b', storage), null);
});

test('retryable auth refresh failure can restore the last exact principal conservatively', async () => {
  const storage = new MemoryStorage();
  await cacheSuccessfulAccount('supabase-user-a', account(), storage);
  const restored = await restoreLastOfflineAccount(storage);
  assert.equal(restored?.id, 'database-account-42');
  assert.equal(restored?.email, '');
  assert.equal(restored?.entitlements.canAccessFullToday, false);
  await clearLastOfflineAccount(storage);
  assert.equal(await restoreLastOfflineAccount(storage), null);
});

test('cache rejects a payload whose embedded auth identity does not match its key', async () => {
  const storage = new MemoryStorage();
  await cacheSuccessfulAccount('supabase-user-a', account(), storage);
  const [key, raw] = [...storage.values.entries()][0];
  const entry = JSON.parse(raw) as { authUserId: string };
  entry.authUserId = 'supabase-user-b';
  storage.values.set(key, JSON.stringify(entry));
  assert.equal(await restoreOfflineAccount('supabase-user-a', storage), null);
});

test('cache rejects malformed or incomplete entitlement records', async () => {
  const storage = new MemoryStorage();
  await cacheSuccessfulAccount('supabase-user-a', account(), storage);
  const [key, raw] = [...storage.values.entries()][0];
  const entry = JSON.parse(raw) as { account: { entitlements: Record<string, unknown> } };
  delete entry.account.entitlements.canAccessGroups;
  storage.values.set(key, JSON.stringify(entry));
  assert.equal(await restoreOfflineAccount('supabase-user-a', storage), null);
});

test('logout clearing removes the identity-scoped cache', async () => {
  const storage = new MemoryStorage();
  await cacheSuccessfulAccount('supabase-user-a', account(), storage);
  await clearOfflineAccount('supabase-user-a', storage);
  assert.equal(await restoreOfflineAccount('supabase-user-a', storage), null);
});

test('fallback classification is fail-closed for denials and open only for connectivity failures', () => {
  assert.equal(isOfflineFallbackError(new Error('account_load_timeout')), true);
  assert.equal(isOfflineFallbackError(new TypeError('Failed to fetch')), true);
  assert.equal(isOfflineFallbackError({ message: 'Network request failed' }), true);
  assert.equal(isOfflineFallbackError(new Error('account_not_found')), false);
  assert.equal(isOfflineFallbackError({ code: 'PGRST116', message: 'No rows' }), false);
  assert.equal(isOfflineFallbackError({ code: '42501', message: 'permission denied' }), false);
});
