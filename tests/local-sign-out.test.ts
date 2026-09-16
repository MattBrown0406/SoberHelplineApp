import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  hasOutboxImpact,
  outboxImpact,
  removeSessionLocally,
  signOutLocally,
  type LocalSignOutDeps,
} from '../src/lib/localSignOut';
import type { OutboxItem } from '../src/lib/offlineOutbox';

function deps(log: string[], failAt?: keyof LocalSignOutDeps): LocalSignOutDeps {
  const step = (name: keyof LocalSignOutDeps) => async (arg?: unknown) => {
    log.push(arg === undefined ? name : `${name}:${String(arg)}`);
    if (failAt === name) throw new Error(`${name} failed`);
  };
  return {
    storePendingRevoke: step('storePendingRevoke'),
    discardOutbox: step('discardOutbox'),
    clearOfflineAccount: step('clearOfflineAccount'),
    removeSession: step('removeSession'),
  };
}

test('local sign-out records the revoke first, wipes account data, and forgets the session last', async () => {
  const log: string[] = [];
  await signOutLocally({ accountId: 'acct-1', authUserId: 'auth-1' }, deps(log));
  assert.deepEqual(log, ['storePendingRevoke:acct-1', 'discardOutbox:acct-1', 'clearOfflineAccount:auth-1', 'removeSession']);
});

test('the session is never removed if any cleanup step fails (member stays signed in, nothing half-wiped silently)', async () => {
  for (const failAt of ['storePendingRevoke', 'discardOutbox', 'clearOfflineAccount'] as const) {
    const log: string[] = [];
    await assert.rejects(signOutLocally({ accountId: 'acct-1', authUserId: null }, deps(log, failAt)), new RegExp(failAt));
    assert.ok(!log.includes('removeSession'), `${failAt}: session must survive`);
  }
});

test('outbox impact counts what an offline sign-out would discard', () => {
  const items: OutboxItem[] = [
    { id: '1', kind: 'checkin', queuedAt: 'x', payload: {} as OutboxItem['payload'] },
    { id: '2', kind: 'journal', queuedAt: 'x', payload: {} as OutboxItem['payload'] },
    { id: '3', kind: 'journal', queuedAt: 'x', payload: {} as OutboxItem['payload'] },
  ] as OutboxItem[];
  assert.deepEqual(outboxImpact(items), { checkin: 1, journal: 2 });
  assert.equal(hasOutboxImpact(outboxImpact(items)), true);
  assert.equal(hasOutboxImpact(outboxImpact([])), false);
});

// --- auth-js contract -------------------------------------------------------
// The shim relies on auth-js's own session-removal step. Pin the installed
// version to the behaviour we depend on so an upgrade cannot silently make
// "Sign out anyway" a no-op.

function fakeJwt(exp: number): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'auth-1', exp, role: 'authenticated', aud: 'authenticated' })}.sig`;
}

const STORAGE_KEY = 'sb-offline-test-auth-token';

function offlineClient() {
  const disk = new Map<string, string>();
  let fetches = 0;
  // A session already on disk, as after a normal sign-in; the token is unexpired
  // so nothing needs the server until we ask it to sign out.
  const exp = Math.floor(Date.now() / 1000) + 3600;
  disk.set(STORAGE_KEY, JSON.stringify({
    access_token: fakeJwt(exp), refresh_token: 'refresh-1', token_type: 'bearer', expires_in: 3600, expires_at: exp,
    user: { id: 'auth-1', aud: 'authenticated', role: 'authenticated', email: 'member@example.com', app_metadata: {}, user_metadata: {}, created_at: '' },
  }));
  const client = createClient('https://offline-test.supabase.co', 'anon-key', {
    auth: {
      storageKey: STORAGE_KEY,
      storage: {
        getItem: async (key: string) => disk.get(key) ?? null,
        setItem: async (key: string, value: string) => { disk.set(key, value); },
        removeItem: async (key: string) => { disk.delete(key); },
      },
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: async () => { fetches += 1; throw new TypeError('Network request failed'); } },
  });
  return { client, disk, fetches: () => fetches };
}

test('auth-js signOut() keeps the session when offline, and removeSessionLocally() forgets it without the network', async () => {
  const { client, disk, fetches } = offlineClient();
  const events: string[] = [];
  client.auth.onAuthStateChange((event) => { events.push(event); });
  assert.equal((await client.auth.getSession()).data.session?.user.id, 'auth-1', 'stored session loads without the network');
  assert.equal(fetches(), 0);

  const { error } = await client.auth.signOut({ scope: 'local' });
  assert.ok(error, 'offline signOut reports an error');
  assert.ok(fetches() > 0, 'signOut tried the server');
  assert.notEqual((await client.auth.getSession()).data.session, null, 'session survived the failed signOut — the reason the shim exists');

  const before = fetches();
  await removeSessionLocally(client.auth);
  assert.equal(fetches(), before, 'local removal never touches the network');
  assert.equal((await client.auth.getSession()).data.session, null);
  assert.equal(disk.has(STORAGE_KEY), false, 'stored session removed');
  assert.ok(events.includes('SIGNED_OUT'), 'SIGNED_OUT emitted so AccountContext resets like a normal sign-out');
});

test('the settings screen offers "Sign out anyway" only for offline failures and routes through the context', () => {
  const source = readFileSync('app/settings.tsx', 'utf8');
  assert.match(source, /if \(isOfflineFallbackError\(error\)\) await offerSignOutAnyway\(\);/);
  assert.match(source, /if \(user && isOfflineFallbackError\(signOutError\)\) await offerSignOutAnyway\(\);/);
  assert.match(source, /style: 'destructive',\s*onPress: \(\) => \{\s*void signOutLocally\(\)/);
  assert.match(source, /t\('signOutOffline\.bodyWithQueue', \{ checkins: impact\.checkin, notes: impact\.journal \}\)/);
  const context = readFileSync('src/contexts/AccountContext.tsx', 'utf8');
  assert.match(context, /discardOutbox: \(id\) => offlineOutbox\.clear\(id\)/);
  assert.match(context, /storePendingRevoke: \(id\) => storePendingPushTokenRevoke\(id\)/);
  assert.match(context, /removeSession: \(\) => removeSessionLocally\(supabase\.auth\)/);
});
