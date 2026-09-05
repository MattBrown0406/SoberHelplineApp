// Keep the owned module's contract suite included in the repository's npm test glob.
import '../src/reminders/personalReminders.test';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import * as core from '../src/reminders/personalReminders';
import { reminderCopy } from '../src/reminders/copy';
import { getPushDestination } from '../src/lib/pushRouting';

function load(file: string, mocks: Record<string, unknown>) {
  const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (!(name in mocks)) throw Error(`Unexpected dependency: ${name}`);
    return mocks[name];
  }, module, module.exports);
  return module.exports;
}

test('actual Expo adapter uses discreet payload, fixed local daily trigger and no destination', async () => {
  const disk = new Map<string, string>(); const scheduled = new Map<string, any>();
  let prompts = 0;
  const notifications = {
    getAllScheduledNotificationsAsync: async () => [...scheduled.values()],
    cancelScheduledNotificationAsync: async (id: string) => { scheduled.delete(id); },
    dismissNotificationAsync: async () => undefined,
    getPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
    requestPermissionsAsync: async () => { prompts++; return { granted: true }; },
    scheduleNotificationAsync: async (request: any) => { scheduled.set(request.identifier, request); return request.identifier; },
    SchedulableTriggerInputTypes: { DAILY: 'daily' },
  };
  const { personalReminders: service } = load('src/reminders/native.ts', {
    '@react-native-async-storage/async-storage': { getItem: async (key: string) => disk.get(key) ?? null, setItem: async (key: string, value: string) => { disk.set(key, value); } },
    'react-native': { Platform: { OS: 'ios' } }, 'expo-notifications': notifications,
    'expo-crypto': { randomUUID: () => 'opaque-id' }, './personalReminders': core, './copy': { reminderCopy },
  });
  await service.setAccount('private-account');
  assert.equal(prompts, 0);
  await service.enable('coaching', 18, 30, 'es');
  const request = [...scheduled.values()][0];
  assert.deepEqual(request.content, { title: 'Un momento para ti', body: 'Abre la app cuando te venga bien.', sound: false, data: {} });
  assert.deepEqual(request.trigger, { type: 'daily', hour: 18, minute: 30, channelId: 'personal-reminders' });
  assert.equal(getPushDestination(request.content.data), null);
  assert.equal(JSON.stringify(request).includes('private-account'), false);
  assert.equal(JSON.stringify(request).includes('coaching'), false);
});

test('actual existing nudge rearm preserves personal schedules; automatic registration does not prompt', async () => {
  const pending = new Map<string, any>([[`${core.REMINDER_PREFIX}keep`, { identifier: `${core.REMINDER_PREFIX}keep` }], ['legacy-nudge', { identifier: 'legacy-nudge' }]]);
  const canceled: string[] = []; let granted = true; let prompts = 0;
  class Barrier { begin() { return 1; } isCurrent() { return true; } track(_id: string, promise: Promise<any>) { return promise; } }
  const exports = load('src/hooks/usePushNotifications.ts', {
    react: { useEffect: () => undefined }, 'react-native': { Platform: { OS: 'ios' }, AppState: {} },
    'expo-notifications': {
      setNotificationHandler: () => undefined,
      getPermissionsAsync: async () => ({ status: granted ? 'granted' : 'denied' }),
      requestPermissionsAsync: async () => { prompts++; return { status: 'denied' }; },
      getAllScheduledNotificationsAsync: async () => [...pending.values()],
      cancelScheduledNotificationAsync: async (id: string) => { canceled.push(id); pending.delete(id); },
      scheduleNotificationAsync: async () => 'nudge', SchedulableTriggerInputTypes: { DATE: 'date' },
    },
    'expo-constants': {}, 'expo-router': { useRouter: () => ({}) },
    '@react-native-async-storage/async-storage': { getItem: async () => null },
    '../i18n': { t: () => 'reminder' }, '../lib/supabase': { supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } },
    '../storage/checkIn': { getCheckIn: async () => null }, '../lib/appFlowGuards': { AsyncWriteBarrier: Barrier },
    '../lib/pushRouting': {}, '../reminders/personalReminders': core,
  });
  await exports.rearmDailyNudge();
  assert.deepEqual(canceled, []); assert.ok(pending.has('legacy-nudge')); assert.ok(pending.has(`${core.REMINDER_PREFIX}keep`));
  granted = false;
  assert.equal(await exports.registerForPushNotifications('account', false), false);
  assert.equal(prompts, 0);
});

test('scoped EN/ES copy has matching keys and category coverage', () => {
  assert.deepEqual(Object.keys(reminderCopy.en).sort(), Object.keys(reminderCopy.es).sort());
  for (const locale of ['en', 'es'] as const) assert.deepEqual(Object.keys(reminderCopy[locale].categories).sort(), [...core.REMINDER_CATEGORIES].sort());
});
