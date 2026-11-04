import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as core from '../src/reminders/personalReminders';

const read = (path: string) => fs.readFileSync(path, 'utf8');

function quietModule() {
  const store = new Map<string, string>();
  const calls: string[] = [];
  let items: core.PersonalReminder[] = [
    { category: 'boundary', hour: 8, minute: 0, enabled: true, notificationId: 'personal-reminder-v1-a', locale: 'en' },
    { category: 'meeting', hour: 18, minute: 30, enabled: false, notificationId: null, locale: 'en' },
  ];
  const service = {
    setAccount: async (id: string) => { calls.push(`set:${id}`); },
    snapshot: () => ({ accountId: 'A', ready: true, supported: true, items, error: null }),
    pause: async (category: string) => {
      calls.push(`pause:${category}`);
      items = items.map((r) => r.category === category ? { ...r, enabled: false, notificationId: null } : r);
    },
    restoreAfterAbortedExit: async (id: string, armed: core.PersonalReminder[]) => {
      calls.push(`restore:${id}:${armed.map((r) => r.category).join(',')}`);
    },
  };
  const modules: Record<string, unknown> = {
    '@react-native-async-storage/async-storage': { __esModule: true, default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => { store.set(k, v); },
      removeItem: async (k: string) => { store.delete(k); },
    } },
    './native': { personalReminders: service },
    './personalReminders': core,
  };
  const code = ts.transpileModule(read('src/reminders/bereavementQuiet.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function('require', 'exports', code)((id: string) => modules[id], exports);
  return { api: exports, store, calls, items: () => items };
}

test('pausing her own reminders remembers the ones that were on, and turning back on restores exactly those', async () => {
  const m = quietModule();
  await m.api.pausePersonalRemindersForQuiet('A');
  assert.deepEqual(m.calls, ['set:A', 'pause:boundary']);
  assert.equal(m.items().every((r) => !r.enabled), true, 'nothing left scheduled');
  const remembered = JSON.parse(m.store.get(m.api.quietRemindersKey('A')) ?? '[]');
  assert.deepEqual(remembered.map((r: core.PersonalReminder) => r.category), ['boundary']);
  // A second pause (e.g. another foreground) keeps the list.
  await m.api.pausePersonalRemindersForQuiet('A');
  assert.deepEqual(JSON.parse(m.store.get(m.api.quietRemindersKey('A')) ?? '[]').map((r: core.PersonalReminder) => r.category), ['boundary']);
  await m.api.resumePersonalRemindersAfterQuiet('A');
  assert.ok(m.calls.includes('restore:A:boundary'));
  assert.equal(m.store.has(m.api.quietRemindersKey('A')), false, 'the device list is cleared after restoring');
  // Not paused before: resuming does nothing.
  const fresh = quietModule();
  await fresh.api.resumePersonalRemindersAfterQuiet('A');
  assert.deepEqual(fresh.calls, []);
});

test('the device list is account scoped, so the deletion purge removes it', async () => {
  const { accountLocalKeys } = await import('../src/lib/accountLocalKeys');
  const m = quietModule();
  const id = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(accountLocalKeys([m.api.quietRemindersKey(id), m.api.quietRemindersKey('22222222-2222-4222-8222-222222222222')], [id]),
    [m.api.quietRemindersKey(id)]);
});

test('the pause is offered in the sheet (off by default), on the grief card, and in Settings', () => {
  const sheet = read('src/components/bereavement/BereavementSheet.tsx');
  assert.match(sheet, /const \[quiet, setQuiet\] = useState\(false\);/);
  assert.match(sheet, /await onConfirm\(contact, quiet\);/);
  assert.match(read('src/components/bereavement/GriefCard.tsx'), /t\(quiet \? 'bereavement\.grief\.resume' : 'bereavement\.grief\.pause'\)/);
  const settings = read('src/components/bereavement/BereavementSettingsCard.tsx');
  assert.match(settings, /<Switch[\s\S]*value=\{!quiet\}/);
  const today = read('app/(tabs)/index.tsx');
  assert.match(today, /await markDied\(contact, quiet\);/);
  assert.match(today, /onSetQuiet=\{async \(quiet\) => \{\s*await setQuiet\(quiet\);\s*void rearmDailyNudge\(\)/);
  const hook = read('src/hooks/useLovedOne.ts');
  assert.match(hook, /rpc\('set_bereavement_quiet', \{ p_quiet: quiet \}\)/);
  assert.match(hook, /if \(quiet\) await supabase\.rpc\('set_bereavement_quiet', \{ p_quiet: true \}\);/);
  for (const lang of ['en', 'es']) {
    const todayCopy = JSON.parse(read(`src/locales/${lang}/today.json`)).bereavement;
    const settingsCopy = JSON.parse(read(`src/locales/${lang}/settings.json`)).bereavement;
    for (const key of ['pause', 'resume', 'pausedNote', 'quietError']) assert.ok(todayCopy.grief[key], `${lang} grief.${key}`);
    assert.ok(todayCopy.sheet.quiet, `${lang} sheet.quiet`);
    assert.ok(settingsCopy.remindersLabel && settingsCopy.remindersDesc, `${lang} settings`);
  }
});

test('the server pause covers the direct senders too', () => {
  const sql = read('supabase/migrations/20261105140000_bereavement_quiet.sql');
  assert.match(sql, /v_account uuid := public\.my_account_id\(\);/);
  assert.match(sql, /IF _account_reminders_paused\(a\.id\) THEN RETURN NULL; END IF;/);
  assert.match(sql, /bereavement_quiet = false/, 'undo lifts the pause');
  assert.match(read('supabase/functions/notify-daily-morning/index.ts'), /a\.remindersPaused\)/);
  assert.match(read('supabase/functions/daily-nudge/index.ts'), /a\.remindersPaused \|\|/);
  assert.match(read('supabase/functions/notify-session-reminder/index.ts'), /remindersPausedFor\(a\.loved_ones\)/);
  assert.match(read('supabase/functions/notify-la-sobremesa/index.ts'), /remindersPausedFor\(a\.loved_ones\)/);
  const device = read('src/hooks/usePushNotifications.ts');
  assert.match(device, /loved_ones\(died_at, bereavement_quiet\)/);
  assert.match(device, /if \(remindersPaused\) return;/);
});
