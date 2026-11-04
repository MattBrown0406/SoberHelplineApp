import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { AsyncWriteBarrier } from '../src/lib/appFlowGuards';

function harness(platform = 'ios', serverDailyOptIn = false, server: { pushToken?: string | null; hour?: number | null; quiet?: boolean } = {}) {
  const quietCalls: string[] = [];
  let serverHour = server.hour ?? null;
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
        if (name === 'set_daily_push_hour') serverHour = args.p_hour;
        return { data: true };
      },
      auth: { getSession: async () => ({ data: { session: { user: { id: 'auth' } } } }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'A', timezone: null, daily_push_opt_in: serverDailyOptIn, daily_push_hour: serverHour, push_token: server.pushToken ?? null, loved_ones: server.quiet === undefined ? null : { died_at: '2026-11-04T00:00:00Z', bereavement_quiet: server.quiet } } }) }) }) }),
    } }, '../storage/checkIn': { getCheckIn: async () => null },
    '../lib/appFlowGuards': { AsyncWriteBarrier }, '../lib/pushRouting': {},
    '../lib/pendingPushTokenRevoke': { settlePendingPushTokenRevoke: async () => 'none' }, '../lib/pushDevice': { isDeviceSignedIn: () => true },
    '../reminders/personalReminders': { REMINDER_PREFIX: 'personal-reminder:' },
    '../reminders/bereavementQuiet': {
      pausePersonalRemindersForQuiet: async (id: string) => { quietCalls.push(`pause:${id}`); },
      resumePersonalRemindersAfterQuiet: async (id: string) => { quietCalls.push(`resume:${id}`); },
    },
  };
  const code = ts.transpileModule(fs.readFileSync('src/hooks/usePushNotifications.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const exports: any = {};
  new Function('require', 'exports', code)((name: string) => modules[name], exports);
  return { api: exports, store, scheduled, canceled, writes: () => writes, rpcCalls, quietCalls };
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

// One opt-in drives the server morning note and the device nudge: a morning
// hour is the server's (at her hour), a later hour is the device's — never both.
const dailyNudges = (h: ReturnType<typeof harness>) => h.scheduled.filter((x) => x.identifier?.includes(':daily-'));
test('a morning reminder hour with this device\'s token on file is sent by the server only', async () => {
  const h = harness('ios', false, { pushToken: 'token' });
  assert.equal(await h.api.registerForPushNotifications('A', true, true), true);
  assert.equal(dailyNudges(h).length, 0);
  assert.ok(h.scheduled.some((x) => x.identifier?.endsWith(':weekly')));
});
test('a later reminder hour is mirrored to the server and sent by the device', async () => {
  const h = harness('ios', false, { pushToken: 'token', hour: 9 });
  h.store.set('reminderHour', '18');
  assert.equal(await h.api.registerForPushNotifications('A', true, true), true);
  assert.ok(h.rpcCalls.some((c) => c.name === 'set_daily_push_hour' && c.args.p_hour === 18));
  assert.ok(dailyNudges(h).length > 0);
  assert.ok(dailyNudges(h).every((x) => new Date(x.trigger.date).getHours() === 18));
});
test('without a server push token the device keeps the morning nudge', async () => {
  const h = harness('ios', false, { pushToken: null });
  assert.equal(await h.api.registerForPushNotifications('A', true, true), true);
  assert.ok(dailyNudges(h).length > 0);
});

test('when another device holds the server token, this device keeps its own nudge', async () => {
  const h = harness('ios', false, { pushToken: 'ExponentPushToken[other-device]' });
  assert.equal(await h.api.registerForPushNotifications('A', true, true), true);
  assert.ok(dailyNudges(h).length > 0);
});

test('a bereaved member who paused reminders gets nothing scheduled on this device; turning them back on restores', async () => {
  const quiet = harness('ios', false, { pushToken: null, quiet: true });
  quiet.store.set('reminderHour', '18');
  await quiet.api.registerForPushNotifications('A', true, true);
  assert.equal(quiet.scheduled.length, 0, 'no daily nudge, no week review');
  assert.ok(quiet.canceled.includes('legacy-daily-nudge:v1:daily-1'), 'already scheduled nudges are cancelled');
  assert.ok(quiet.quietCalls.includes('pause:A'), 'personal reminders pause too');
  const back = harness('ios', false, { pushToken: null, quiet: false });
  back.store.set('reminderHour', '18');
  await back.api.registerForPushNotifications('A', true, true);
  assert.ok(back.quietCalls.includes('resume:A'));
  assert.ok(dailyNudges(back).length > 0, 'nudges are scheduled again');
});
