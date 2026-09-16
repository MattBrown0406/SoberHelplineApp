import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {
  PENDING_PUSH_TOKEN_REVOKE_KEY,
  clearPendingPushTokenRevoke,
  readPendingPushTokenRevoke,
  settlePendingPushTokenRevoke,
  storePendingPushTokenRevoke,
  type PendingRevokeStorage,
} from '../src/lib/pendingPushTokenRevoke';

function memoryStorage(): PendingRevokeStorage & { disk: Map<string, string> } {
  const disk = new Map<string, string>();
  return {
    disk,
    getItem: async (key) => disk.get(key) ?? null,
    setItem: async (key, value) => { disk.set(key, value); },
    removeItem: async (key) => { disk.delete(key); },
  };
}

test('a pending revoke round-trips and is cleared explicitly', async () => {
  const storage = memoryStorage();
  assert.equal(await readPendingPushTokenRevoke(storage), null);
  await storePendingPushTokenRevoke('acct-1', storage, () => '2026-09-16T12:00:00.000Z');
  assert.deepEqual(await readPendingPushTokenRevoke(storage), { version: 1, accountId: 'acct-1', requestedAt: '2026-09-16T12:00:00.000Z' });
  await clearPendingPushTokenRevoke(storage);
  assert.equal(await readPendingPushTokenRevoke(storage), null);
});

test('unreadable or wrong-version records are discarded, never acted on', async () => {
  for (const raw of ['{not json', '{"version":2,"accountId":"acct-1","requestedAt":"x"}', '{"version":1,"accountId":"","requestedAt":"x"}', '"acct-1"']) {
    const storage = memoryStorage();
    storage.disk.set(PENDING_PUSH_TOKEN_REVOKE_KEY, raw);
    assert.equal(await readPendingPushTokenRevoke(storage), null, raw);
    assert.equal(storage.disk.has(PENDING_PUSH_TOKEN_REVOKE_KEY), false, `${raw} should be removed`);
    assert.equal(await settlePendingPushTokenRevoke('acct-1', async () => { throw new Error('must not run'); }, storage), 'none');
  }
});

test('settling revokes for the same account and keeps the record when the server is unreachable', async () => {
  const storage = memoryStorage();
  const revoked: string[] = [];
  assert.equal(await settlePendingPushTokenRevoke('acct-1', async (id) => { revoked.push(id); }, storage), 'none');
  assert.equal(revoked.length, 0);

  await storePendingPushTokenRevoke('acct-1', storage);
  let online = false;
  const revoke = async (id: string) => { if (!online) throw new Error('Network request failed'); revoked.push(id); };
  assert.equal(await settlePendingPushTokenRevoke('acct-1', revoke, storage), 'retry');
  assert.ok(storage.disk.has(PENDING_PUSH_TOKEN_REVOKE_KEY), 'record survives a failed attempt');
  online = true;
  assert.equal(await settlePendingPushTokenRevoke('acct-1', revoke, storage), 'revoked');
  assert.deepEqual(revoked, ['acct-1']);
  assert.equal(storage.disk.has(PENDING_PUSH_TOKEN_REVOKE_KEY), false);
});

test('a different account signing in supersedes the record without touching the other account', async () => {
  const storage = memoryStorage();
  await storePendingPushTokenRevoke('acct-1', storage);
  const revoked: string[] = [];
  assert.equal(await settlePendingPushTokenRevoke('acct-2', async (id) => { revoked.push(id); }, storage), 'superseded');
  assert.deepEqual(revoked, []);
  assert.equal(storage.disk.has(PENDING_PUSH_TOKEN_REVOKE_KEY), false);
});

// The hook must settle the revoke BEFORE registering, or a fresh registration
// could be nulled by the late revoke.
function loadPushHook(mocks: Record<string, unknown>) {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/hooks/usePushNotifications.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (!(name in mocks)) throw Error(`Unexpected dependency: ${name}`);
    return mocks[name];
  }, module, module.exports);
  return module.exports;
}

test('the push hook settles a pending revoke before re-registering, and skips registration while it is still pending', async () => {
  const calls: string[] = [];
  let settled: 'none' | 'revoked' | 'retry' | 'superseded' = 'revoked';
  class Barrier { begin() { return 1; } isCurrent() { return true; } track(_id: string, promise: Promise<any>) { return promise; } }
  const exports = loadPushHook({
    react: { useEffect: () => undefined }, 'react-native': { Platform: { OS: 'ios' }, AppState: {} },
    'expo-notifications': {
      setNotificationHandler: () => undefined,
      getPermissionsAsync: async () => ({ status: 'granted' }),
      requestPermissionsAsync: async () => ({ status: 'granted' }),
      getExpoPushTokenAsync: async () => ({ data: 'ExponentPushToken[test]' }),
      getAllScheduledNotificationsAsync: async () => [],
      cancelScheduledNotificationAsync: async () => undefined,
      scheduleNotificationAsync: async () => 'nudge', SchedulableTriggerInputTypes: { DATE: 'date' },
    },
    'expo-constants': { expoConfig: { extra: { eas: { projectId: 'proj' } } } }, 'expo-router': { useRouter: () => ({}) },
    '@react-native-async-storage/async-storage': { getItem: async () => null },
    '../i18n': { t: () => 'reminder', language: 'en' },
    '../lib/supabase': { supabase: {
      auth: { getSession: async () => ({ data: { session: null } }) },
      rpc: async (name: string) => { calls.push(`rpc:${name}`); return { data: true, error: null }; },
      from: () => ({ update: () => ({ eq: async () => { calls.push('update:push_token'); return { error: null }; } }) }),
    } },
    '../storage/checkIn': { getCheckIn: async () => null }, '../lib/appFlowGuards': { AsyncWriteBarrier: Barrier },
    '../lib/pushRouting': {}, '../reminders/personalReminders': { REMINDER_PREFIX: 'personal-reminder:' },
    '../lib/pendingPushTokenRevoke': {
      settlePendingPushTokenRevoke: async (_id: string, revoke: (id: string) => Promise<void>) => {
        calls.push('settle');
        if (settled === 'revoked') await revoke(_id);
        return settled;
      },
    },
  });

  assert.equal(await exports.settleRevokeThenRegister('acct-1'), true);
  assert.deepEqual(calls, ['settle', 'update:push_token', 'rpc:register_push_device']);

  calls.length = 0;
  settled = 'retry';
  assert.equal(await exports.settleRevokeThenRegister('acct-1'), false);
  assert.deepEqual(calls, ['settle'], 'no registration while the revoke is still pending');

  calls.length = 0;
  settled = 'none';
  assert.equal(await exports.settleRevokeThenRegister('acct-1'), true);
  assert.deepEqual(calls, ['settle', 'rpc:register_push_device']);

  const hookSource = fs.readFileSync('src/hooks/usePushNotifications.ts', 'utf8');
  assert.match(hookSource, /void settleRevokeThenRegister\(accountId\)/, 'mount path goes through the settle-first helper');
  assert.doesNotMatch(hookSource, /^\s*void registerForPushNotifications\(accountId, false\)/m, 'no bare mount registration');
});
