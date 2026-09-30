import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { AsyncWriteBarrier } from '../src/lib/appFlowGuards';

function harness(platform = 'ios', serverDailyOptIn = false) {
  const store = new Map<string, string>();
  const scheduled: any[] = []; const canceled: string[] = []; let writes = 0;
  const rpcCalls: { name: string; args: any }[] = [];
  const notifications = {
    setNotificationHandler() {}, getPermissionsAsync: async () => ({ status: 'granted' }),
    getExpoPushTokenAsync: async () => ({ data: 'token' }),
    getAllScheduledNotificationsAsync: async () => [
      { identifier: 'personal-reminder:v1:opaque' }, { identifier: 'unknown' },
      { identifier: 'legacy-daily-nudge:v1:daily-1' },
    ],
    cancelScheduledNotificationAsync: async (id: string) => { canceled.push(id); },
    scheduleNotificationAsync: async (request: any) => { scheduled.push(request); return request.identifier; },
    SchedulableTriggerInputTypes: { DATE: 'date' },
  };
  if (platform === 'web') notifications.getAllScheduledNotificationsAsync = async () => { throw new Error('Native scheduler unavailable'); };
  const modules: Record<string, any> = {
    react: { useEffect() {} }, 'react-native': { Platform: { OS: platform } },
    'expo-notifications': notifications, 'expo-constants': { expoConfig: { extra: { eas: { projectId: 'project' } } } },
    'expo-router': {}, '@react-native-async-storage/async-storage': {
      getItem: async (key: string) => store.get(key) ?? null,
      setItem: async (key: string, value: string) => { store.set(key, value); },
    }, '../i18n': { t: () => 'copy', language: 'en' },
    '../lib/supabase': { supabase: {
      rpc: async (name: string, args: any) => {
        writes++; rpcCalls.push({ name, args });
        if (name === 'set_daily_push_opt_in') serverDailyOptIn = args.p_enabled;
        return { data: true };
      },
      auth: { getSession: async () => ({ data: { session: { user: { id: 'auth' } } } }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'A', timezone: null, daily_push_opt_in: serverDailyOptIn } }) }) }) }),
    } }, '../storage/checkIn': { getCheckIn: async () => null },
    '../lib/appFlowGuards': { AsyncWriteBarrier }, '../lib/pushRouting': {},
    '../lib/pendingPushTokenRevoke': { settlePendingPushTokenRevoke: async () => 'none' }, '../lib/pushDevice': { isDeviceSignedIn: () => true },
    '../reminders/personalReminders': { REMINDER_PREFIX: 'personal-reminder:' },
  };
  const code = ts.transpileModule(fs.readFileSync('src/hooks/usePushNotifications.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const exports: any = {};
  new Function('require', 'exports', code)((name: string) => modules[name], exports);
  return { api: exports, store, scheduled, canceled, writes: () => writes, rpcCalls };
}

test('web logout preserves token barrier without invoking an unavailable native scheduler', async () => {
  const h = harness('web');
  await h.api.cancelPushRegistration('A');
  await h.api.rearmDailyNudge();
  assert.deepEqual(h.canceled, []);
  assert.deepEqual(h.scheduled, []);
});

test('OS permission and ordinary push registration do not opt into daily nudges', async () => {
  const h = harness();
  assert.equal(await h.api.registerForPushNotifications('A', false), true);
  await h.api.rearmDailyNudge();
  assert.equal(h.writes(), 1);
  assert.equal(h.scheduled.length, 0);
});
test('a device that never opted in turns off a backfilled server daily push', async () => {
  const h = harness('ios', true);
  await h.api.registerForPushNotifications('A', false);
  await h.api.rearmDailyNudge();
  assert.deepEqual(
    h.rpcCalls.filter((c) => c.name === 'set_daily_push_opt_in').map((c) => c.args),
    [{ p_enabled: false }],
  );
});

test('explicit daily consent reaches the server morning push', async () => {
  const h = harness();
  assert.equal(await h.api.registerForPushNotifications('A', true, true), true);
  assert.ok(h.rpcCalls.some((c) => c.name === 'set_daily_push_opt_in' && c.args.p_enabled === true));
});

test('explicit daily consent schedules owned IDs only and does not cross accounts', async () => {
  const h = harness();
  assert.equal(await h.api.registerForPushNotifications('A', true, true), true);
  assert.ok(h.scheduled.length > 0);
  assert.ok(h.scheduled.every(x => x.identifier?.startsWith('legacy-daily-nudge:v1:')));
  assert.ok(h.canceled.every(x => x.startsWith('legacy-daily-nudge:v1:')));
  h.scheduled.length = 0;
  await h.api.registerForPushNotifications('B', false);
  assert.equal(h.scheduled.length, 0);
});
test('deliberate token registration alone is not consent for daily reminders', async () => {
  const h = harness();
  await h.api.registerForPushNotifications('A');
  assert.equal(h.scheduled.length, 0);
});
