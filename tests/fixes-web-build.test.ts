import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyInputValue,
  composeDateAndTime,
  fieldBaseValue,
  mergeDatePart,
  mergePickedValue,
  mergeTimePart,
  toDateInputValue,
  toInputValue,
  toTimeInputValue,
} from '../src/lib/dateTimeInput';
import {
  browserSessionStorage,
  choosePlanStore,
  isSessionOnlyPlanStorage,
  sessionPlanStore,
  WEB_SESSION_PLAN_PREFIX,
  type ProtectedPlanStore,
} from '../src/lib/webSessionPlanStore';
import { videoErrorCode, videoErrorText } from '../src/lib/videoErrors';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (file: string) => readFileSync(resolve(ROOT, file), 'utf8');

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
}

// ── DateTimeField values ────────────────────────────────────────────────────
test('web input values are local date and time strings', () => {
  const value = new Date(2026, 9, 6, 9, 5);
  assert.equal(toDateInputValue(value), '2026-10-06');
  assert.equal(toTimeInputValue(value), '09:05');
  assert.equal(toInputValue(value, 'date'), '2026-10-06');
  assert.equal(toInputValue(value, 'time'), '09:05');
});

test('a web date or time input changes only its own part', () => {
  const current = new Date(2026, 9, 6, 15, 30);
  const date = applyInputValue(current, '2026-11-02', 'date');
  assert.deepEqual(date && [date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()], [2026, 10, 2, 15, 30]);
  const time = applyInputValue(current, '07:45', 'time');
  assert.deepEqual(time && [time.getFullYear(), time.getMonth(), time.getDate(), time.getHours(), time.getMinutes()], [2026, 9, 6, 7, 45]);
  assert.equal(applyInputValue(current, '07:45:30', 'time')?.getMinutes(), 45, 'browsers may send seconds');
});

test('cleared or impossible web values keep the previous value', () => {
  const current = new Date(2026, 9, 6, 15, 30);
  assert.equal(applyInputValue(current, '', 'date'), null);
  assert.equal(applyInputValue(current, '', 'time'), null);
  assert.equal(applyInputValue(current, '2026-02-31', 'date'), null);
  assert.equal(applyInputValue(current, '24:00', 'time'), null);
  assert.equal(applyInputValue(current, 'tomorrow', 'date'), null);
});

test('a native pick merges only the picked part', () => {
  const current = new Date(2026, 9, 6, 15, 30);
  const picked = new Date(2027, 0, 9, 8, 10);
  assert.deepEqual(mergeDatePart(current, picked), new Date(2027, 0, 9, 15, 30));
  assert.deepEqual(mergeTimePart(current, picked), new Date(2026, 9, 6, 8, 10));
  assert.deepEqual(mergePickedValue(current, picked, 'date'), new Date(2027, 0, 9, 15, 30));
  assert.deepEqual(mergePickedValue(current, picked, 'time'), new Date(2026, 9, 6, 8, 10));
});

test('scheduling cards and They Said Yes use the cross-platform field', () => {
  for (const file of [
    'src/components/video/PlanReviewBookingCard.tsx',
    'src/components/video/PremierVideoSchedulingCard.tsx',
    'src/components/treatment/TheySaidYesMode.tsx',
    'src/components/admin/VideoSessionManager.tsx',
  ]) {
    const source = read(file);
    assert.match(source, /<DateTimeField/, `${file} uses DateTimeField`);
    assert.doesNotMatch(source, /@react-native-community\/datetimepicker/, `${file} no longer renders the native-only picker`);
  }
  const field = read('src/components/ui/DateTimeField.tsx');
  assert.match(field, /Platform\.OS === 'web'/);
  assert.match(field, /React\.createElement\('input'/);
});

// ── Alert.alert is a no-op on web ───────────────────────────────────────────
test('member screens use appAlert instead of the web no-op Alert.alert', () => {
  const files = [
    'app/(tabs)/boundaries.tsx', 'app/family-outcomes.tsx', 'app/family-visitation-plan.tsx', 'app/homecoming-week.tsx',
    'app/diy-intervention-planner.tsx', 'app/community.tsx', 'app/book-coaching.tsx',
    'src/components/tracker/WillingnessWindowCard.tsx', 'src/components/treatment/TheySaidYesMode.tsx',
    'src/components/video/PlanReviewBookingCard.tsx', 'src/components/video/PremierVideoSchedulingCard.tsx',
    'app/(onboarding)/consent.tsx', 'app/(onboarding)/loved-one.tsx', 'app/(onboarding)/notifications.tsx',
    'app/crisis-mode.tsx', 'src/components/today/CheckInCard.tsx', 'app/(tabs)/tracker.tsx', 'app/trajectory.tsx',
    'app/finder/inquiry.tsx', 'src/components/safety/FamilyEmergencyCard.tsx', 'src/components/safety/SafetyWalletExport.tsx',
  ];
  for (const file of files) assert.doesNotMatch(read(file), /Alert\.alert\(/, `${file} still calls Alert.alert`);
  // The wallet's clear confirmation already branches to window.confirm on web.
  const wallet = read('app/safety-wallet.tsx');
  assert.equal(wallet.match(/Alert\.alert\(/g)?.length, 1);
  assert.match(wallet, /if \(Platform\.OS === 'web'\) \{\s*if \(globalThis\.confirm/);
});

// ── Plans on web ────────────────────────────────────────────────────────────
test('the web plan store keeps values in sessionStorage under a private prefix', async () => {
  const storage = memoryStorage();
  const store = sessionPlanStore(storage);
  assert.equal(await store.isAvailableAsync(), true);
  assert.equal(await store.getItemAsync('plan:a'), null);
  await store.setItemAsync('plan:a', '{"x":1}', { keychainAccessible: 1 });
  assert.equal(storage.map.get(`${WEB_SESSION_PLAN_PREFIX}plan:a`), '{"x":1}');
  assert.equal(await store.getItemAsync('plan:a'), '{"x":1}');
  await store.deleteItemAsync('plan:a');
  assert.equal(storage.map.size, 0);
});

test('without sessionStorage the plan store reports itself unavailable', async () => {
  const store = sessionPlanStore(null);
  assert.equal(await store.isAvailableAsync(), false);
  await assert.rejects(store.getItemAsync('k'), /protected_storage_unavailable/);
  assert.equal(browserSessionStorage({}), null);
  assert.equal(browserSessionStorage({ get sessionStorage() { throw new Error('SecurityError'); } }), null);
  const blocked = { sessionStorage: { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); }, removeItem: () => undefined } };
  assert.equal(browserSessionStorage(blocked), null);
});

test('native keeps the protected store; web gets the session store', async () => {
  const native: ProtectedPlanStore = {
    isAvailableAsync: async () => true, getItemAsync: async () => 'native',
    setItemAsync: async () => undefined, deleteItemAsync: async () => undefined,
  };
  assert.equal(choosePlanStore('ios', native, {}), native);
  assert.equal(choosePlanStore('android', native, {}), native);
  const storage = memoryStorage();
  const web = choosePlanStore('web', native, { sessionStorage: storage });
  assert.notEqual(web, native);
  await web.setItemAsync('k', 'v');
  assert.equal(await web.getItemAsync('k'), 'v');
  assert.equal(isSessionOnlyPlanStorage('web'), true);
  assert.equal(isSessionOnlyPlanStorage('ios'), false);
});

test('the four plan stores and their screens are wired for web', () => {
  for (const file of ['treatmentActionPlan', 'familyVisitationPlan', 'homecomingWeek', 'diyInterventionPlanner']) {
    const source = read(`src/storage/${file}.ts`);
    assert.match(source, /const SecureStore = choosePlanStore\(Platform\.OS, NativeSecureStore, globalThis\)/, file);
    assert.match(source, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/, file);
    for (const lang of ['en', 'es']) {
      const copy = JSON.parse(read(`src/locales/${lang}/${file}.json`)) as Record<string, unknown>;
      assert.equal(typeof copy.webSessionNotice, 'string', `${lang}/${file} has the web notice`);
    }
  }
  for (const screen of ['app/family-visitation-plan.tsx', 'app/homecoming-week.tsx', 'app/diy-intervention-planner.tsx']) {
    assert.match(read(screen), /isSessionOnlyPlanStorage\(Platform\.OS\) \?[\s\S]{0,160}t\('webSessionNotice'\)/, screen);
  }
});

// ── DateTimeField without a value / They Said Yes leave time ────────────────
test('a field with nothing chosen merges into the suggestion; date and time compose only when both are chosen', () => {
  const suggestion = new Date(2026, 9, 6, 22, 0);
  assert.equal(fieldBaseValue(null, suggestion), suggestion);
  const chosen = new Date(2026, 9, 7, 8, 0);
  assert.equal(fieldBaseValue(chosen, suggestion), chosen);
  const now = new Date(2026, 0, 1);
  assert.equal(fieldBaseValue(null, undefined, now), now);
  assert.equal(composeDateAndTime(null, chosen), null);
  assert.equal(composeDateAndTime(chosen, null), null);
  assert.deepEqual(composeDateAndTime(new Date(2026, 9, 7, 3, 3), new Date(2020, 0, 1, 21, 45)), new Date(2026, 9, 7, 21, 45));
  const field = read('src/components/ui/DateTimeField.tsx');
  assert.match(field, /value: value \? toInputValue\(value, mode\) : ''/, 'an unset web field renders empty');
});

test('the leave time is a draft until the explicit Lock/Save action', () => {
  const yes = read('src/components/treatment/TheySaidYesMode.tsx');
  assert.match(yes, /onChange=\{\(date\) => setDraft\(/);
  assert.match(yes, /onChange=\{\(time\) => setDraft\(/);
  // The only write of departureAt from the picker is inside lockDeparture.
  const lock = yes.slice(yes.indexOf('function lockDeparture()'), yes.indexOf('function logYes()'));
  assert.match(lock, /next\.getTime\(\) <= Date\.now\(\)\) return;/);
  assert.match(lock, /departureAt: next\.toISOString\(\)/);
  assert.equal(yes.match(/departureAt: next\.toISOString\(\)/g)?.length, 1);
  assert.match(yes, /onPress=\{lockDeparture\}/);
  assert.match(yes, /disabled=\{!draftDeparture \|\| draftInPast \|\| draftSaved\}/);
  for (const lang of ['en', 'es']) {
    const copy = JSON.parse(read(`src/locales/${lang}/treatmentActionPlan.json`)) as { yesMode: Record<string, string> };
    for (const key of ['lockLeaveTime', 'saveLeaveTime', 'leaveTimePast']) assert.equal(typeof copy.yesMode[key], 'string', `${lang} ${key}`);
  }
});

// ── Video errors never show raw text ────────────────────────────────────────
test('network and unknown video errors map to the card\'s own unknown message', () => {
  assert.equal(videoErrorCode(null), null);
  assert.equal(videoErrorCode({ message: 'TypeError: Network request failed', code: '' }), 'unknown');
  assert.equal(videoErrorCode({ message: 'whatever', code: 'PGRST301' }), 'unknown');
  assert.equal(videoErrorCode({ message: 'ERROR: start_time_in_past', code: '22023' }), 'start_time_in_past');
  const known: Record<string, string> = { 'errors.unknown': 'Something went wrong', 'errors.version_conflict': 'Changed elsewhere' };
  const k = (key: string, options?: Record<string, unknown>) => known[key] ?? String(options?.defaultValue ?? key);
  assert.equal(videoErrorText(k, 'version_conflict'), 'Changed elsewhere');
  assert.equal(videoErrorText(k, 'checkout_unavailable'), 'Something went wrong', "the other card's code falls back");
  assert.equal(videoErrorText(k, ''), 'Something went wrong');
  assert.equal(videoErrorText(k, null), 'Something went wrong');
  assert.equal(videoErrorText(k, 'TypeError: Network request failed'), 'Something went wrong');
  for (const file of ['src/components/video/PlanReviewBookingCard.tsx', 'src/components/video/PremierVideoSchedulingCard.tsx']) {
    const card = read(file);
    assert.match(card, /videoErrorText\(k, controller\.errorKey\)/, file);
    assert.doesNotMatch(card, /: controller\.error;|\{controller\.error\}/, `${file} never renders the raw message`);
  }
  assert.doesNotMatch(read('src/hooks/usePrivateVideoSessions.ts'), /\?\? error\.code \?\? 'unknown'/);
});

// ── Offline command plan and web exports ────────────────────────────────────
test('the offline command plan card shares what it shows; web exports never print the screen', () => {
  const crisis = read('app/crisis-mode.tsx');
  assert.match(crisis, /commandExportItems: WalletExportItem\[\] = commandPlanVisible \?/);
  assert.match(crisis, /\{commandPlanVisible \? \(/);
  const wallet = read('src/components/safety/SafetyWalletExport.tsx');
  assert.match(wallet, /if \(print && web\) \{[\s\S]*printHtmlInNewWindow\(globalThis, walletPrintHtml\(preview\)\)/);
  assert.match(wallet, /canPrint \? button\(copy\.print/);
  const card = read('src/components/safety/FamilyEmergencyCard.tsx');
  assert.match(card, /shareOrCopy\(preview/);
  for (const lang of ['en', 'es']) {
    const crisisCopy = JSON.parse(read(`src/locales/${lang}/crisis.json`)) as { wallet: Record<string, unknown> };
    assert.equal(typeof crisisCopy.wallet.copiedToClipboard, 'string');
    assert.equal(typeof crisisCopy.wallet.printBlocked, 'string');
  }
});
