import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  REMINDER_ASK_QUIET_DAYS,
  emptyReminderAskMemory,
  parseReminderAskMemory,
  reminderAskStorageKey,
  reminderPermissionFrom,
  seatReminderAsk,
  startsTodayShowing,
  todayReminderAsk,
  type ReminderAskMemory,
} from '../src/lib/reminderAsk';
import { accountLocalKeys } from '../src/lib/accountLocalKeys';

const read = (file: string) => readFileSync(file, 'utf8');
const DAY = 86_400_000;
// Local-time dates, so "the same day" means the member's own day wherever the tests run.
const now = new Date(2026, 10, 13, 15, 0, 0);
const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
const earlierToday = new Date(2026, 10, 13, 8, 30, 0).toISOString();
const memory = (change: Partial<ReminderAskMemory> = {}): ReminderAskMemory => ({ ...emptyReminderAskMemory(), ...change });

test('the device permission is read as granted, askable or blocked; unreadable means do not ask', () => {
  assert.equal(reminderPermissionFrom({ status: 'granted', granted: true, canAskAgain: true }), 'granted');
  assert.equal(reminderPermissionFrom({ status: 'undetermined', granted: false, canAskAgain: true }), 'askable');
  // iOS after "Don't Allow": the system dialog will not show again.
  assert.equal(reminderPermissionFrom({ status: 'denied', granted: false, canAskAgain: false }), 'blocked');
  // Android may still be asked once more after a first "no".
  assert.equal(reminderPermissionFrom({ status: 'denied', granted: false, canAskAgain: true }), 'askable');
  assert.equal(reminderPermissionFrom({ status: 'denied' }), 'blocked');
  assert.equal(reminderPermissionFrom({ status: 'undetermined' }), 'askable');
  assert.equal(reminderPermissionFrom(null), null);
  assert.equal(reminderPermissionFrom(undefined), null);
});

test('after a seat is saved: ask when the dialog can show, point to Settings when it cannot', () => {
  const base = { supported: true, justSaved: true, memory: memory(), now };
  assert.equal(seatReminderAsk({ ...base, permission: 'askable' }), 'ask');
  assert.equal(seatReminderAsk({ ...base, permission: 'blocked' }), 'settings');
  // Reminders already work, or the permission could not be read: nothing to ask.
  assert.equal(seatReminderAsk({ ...base, permission: 'granted' }), null);
  assert.equal(seatReminderAsk({ ...base, permission: null }), null);
  // Only a seat saved just now, never one that was already saved when the screen opened.
  assert.equal(seatReminderAsk({ ...base, permission: 'askable', justSaved: false }), null);
  // No reminders on the web.
  assert.equal(seatReminderAsk({ ...base, permission: 'askable', supported: false }), null);
});

test('"Not now" under a saved seat is respected for 14 days', () => {
  assert.equal(REMINDER_ASK_QUIET_DAYS, 14);
  const base = { supported: true, justSaved: true, permission: 'askable' as const, now };
  assert.equal(seatReminderAsk({ ...base, memory: memory({ seatDismissedAt: ago(1) }) }), null);
  assert.equal(seatReminderAsk({ ...base, memory: memory({ seatDismissedAt: ago(13.9) }) }), null);
  assert.equal(seatReminderAsk({ ...base, memory: memory({ seatDismissedAt: ago(14) }) }), 'ask');
  // Saving a seat is the best moment: Today's own "Not now" or onboarding today does not block it.
  assert.equal(seatReminderAsk({ ...base, memory: memory({ todayDismissedAt: ago(1), onboardedAt: earlierToday }) }), 'ask');
});

const today = (change: Partial<Parameters<typeof todayReminderAsk>[0]> = {}) => todayReminderAsk({
  supported: true,
  permission: 'askable',
  memory: memory(),
  joinedAt: ago(40),
  now,
  seatAskShowing: false,
  welcomeBackShowing: false,
  ...change,
});

test('Today offers a second chance to someone using the app without reminders', () => {
  assert.equal(today(), 'ask');
  assert.equal(today({ permission: 'blocked' }), 'settings');
  assert.equal(today({ permission: 'granted' }), null);
  assert.equal(today({ permission: null }), null);
  assert.equal(today({ supported: false }), null);
  // An account with no known sign-up date (older device data) can still be asked.
  assert.equal(today({ joinedAt: null }), 'ask');
});

test('never on the same day as onboarding', () => {
  assert.equal(today({ memory: memory({ onboardedAt: earlierToday }) }), null);
  // A device that did not record onboarding: the day the account was created stands in.
  assert.equal(today({ joinedAt: earlierToday }), null);
  // The next day is fine.
  assert.equal(today({ memory: memory({ onboardedAt: ago(1) }), joinedAt: ago(1) }), 'ask');
});

test('never while the seat ask or the welcome-back card is showing', () => {
  assert.equal(today({ seatAskShowing: true }), null);
  assert.equal(today({ welcomeBackShowing: true }), null);
});

test('at most one showing every 14 days, and 14 quiet days after any "Not now"', () => {
  // It stays for the day it first appeared, so it does not vanish mid-visit…
  assert.equal(today({ memory: memory({ todayShownAt: earlierToday }) }), 'ask');
  assert.equal(startsTodayShowing(memory({ todayShownAt: earlierToday }), now), false);
  // …and then not again until 14 days have passed.
  assert.equal(today({ memory: memory({ todayShownAt: ago(1) }) }), null);
  assert.equal(today({ memory: memory({ todayShownAt: ago(13.9) }) }), null);
  assert.equal(today({ memory: memory({ todayShownAt: ago(14) }) }), 'ask');
  assert.equal(startsTodayShowing(memory({ todayShownAt: ago(14) }), now), true);
  assert.equal(startsTodayShowing(memory(), now), true);
  // Dismissed today: gone for the rest of today as well.
  assert.equal(today({ memory: memory({ todayShownAt: earlierToday, todayDismissedAt: earlierToday }) }), null);
  assert.equal(today({ memory: memory({ todayDismissedAt: ago(13) }) }), null);
  assert.equal(today({ memory: memory({ todayDismissedAt: ago(15), todayShownAt: ago(15) }) }), 'ask');
  // She said "Not now" under a saved seat a few days ago: Today does not ask again so soon.
  assert.equal(today({ memory: memory({ seatDismissedAt: ago(3) }) }), null);
  assert.equal(today({ memory: memory({ seatDismissedAt: ago(14) }) }), 'ask');
  // A clock set back never makes it ask sooner.
  assert.equal(today({ memory: memory({ todayDismissedAt: new Date(now.getTime() + 3 * DAY).toISOString() }) }), null);
});

test('what the device remembers is per account and survives bad data', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(accountLocalKeys([reminderAskStorageKey(id), reminderAskStorageKey('22222222-2222-4222-8222-222222222222')], [id]), [reminderAskStorageKey(id)]);
  const saved = memory({ onboardedAt: ago(20), seatDismissedAt: ago(3), todayShownAt: ago(2), todayDismissedAt: ago(2) });
  assert.deepEqual(parseReminderAskMemory(JSON.stringify(saved)), saved);
  for (const raw of [null, undefined, '', 'nope', '[]', '{"schemaVersion":2}', '{"schemaVersion":1,"seatDismissedAt":"yesterday","todayShownAt":7}']) {
    assert.deepEqual(parseReminderAskMemory(raw), emptyReminderAskMemory());
  }
});

test('only "Remind me" can open the system dialog, and a grant registers the device like onboarding', () => {
  const hook = read('src/hooks/useReminderAsk.ts');
  // The one call that may prompt is behind the button; every other path registers without prompting.
  assert.match(hook, /const remindMe = useCallback\(\(\) => \{ void register\(true\); \}, \[register\]\);/);
  assert.equal((hook.match(/register\(true\)/g) ?? []).length, 1);
  assert.match(hook, /await registerForPushNotifications\(accountId, askSystem\)\.catch\(\(\) => false\)/);
  assert.equal((hook.match(/registerForPushNotifications\(/g) ?? []).length, 1);
  assert.doesNotMatch(hook, /requestPermissionsAsync/);
  // A refusal ends on the Settings line; a grant that could not register can be retried.
  assert.match(hook, /setView\(registered \? 'on' : permission === 'blocked' \? 'settings' : permission === 'granted' \? 'failed' : 'ask'\)/);
  assert.match(hook, /void Linking\.openSettings\(\)\.catch\(\(\) => undefined\);/);
  // "Remind me" also makes sure the Monday reminder is not switched off in Settings (best effort, only after a grant).
  assert.match(hook, /if \(registered\) void Promise\.resolve\(supabase\.rpc\('set_family_call_reminders', \{ p_enabled: true \}\)\)\.catch\(\(\) => undefined\);/);
  // Back from device Settings with notifications allowed: registered without another prompt.
  assert.match(hook, /if \(permission === 'granted'\) \{\s*await register\(false\);/);
  // Reading the permission never prompts.
  const store = read('src/lib/reminderAskStore.ts');
  assert.match(store, /reminderPermissionFrom\(await Notifications\.getPermissionsAsync\(\)\)/);
  assert.doesNotMatch(store, /requestPermissionsAsync/);
  // Storage that cannot be read asks nothing, and a write that failed tells nobody (no ask on a guess, no loop).
  assert.match(store, /catch \{\s*return null;\s*\}/);
  assert.match(store, /if \(!saved\) return;/);
  // The pure rules never touch the device.
  assert.doesNotMatch(read('src/lib/reminderAsk.ts'), /^import /m);
});

test('the seat ask appears only when a seat goes from not saved to saved', () => {
  const hook = read('src/hooks/useReminderAsk.ts');
  assert.match(hook, /const was = previous\.current;\s*previous\.current = rsvp;\s*if \(rsvp !== 'going'\) \{\s*setView\(null\);/);
  assert.match(hook, /if \(!enabled \|\| !accountId \|\| was === 'going'\) return undefined;/);
  assert.match(hook, /memory \? seatReminderAsk\(\{ supported: REMINDERS_SUPPORTED, justSaved: true, permission, memory, now \}\) : null/);
  // Today's second chance hears when a seat ask is on screen.
  assert.match(hook, /setSeatReminderAskShowing\(panel, showing\)/);
  assert.match(hook, /seatAskShowing: isSeatReminderAskShowing\(\)/);

  const panel = read('src/components/familySquares/FamilySquaresSeatPanel.tsx');
  assert.match(panel, /const reminders = useSeatReminderAsk\(accountId, rsvp, reminderAsk\);\s*\n\s*if \(rsvp === 'none'\) return null;/);
  assert.match(panel, /<ReminderAskNote ask=\{reminders\} place="seat" \/>/);
  // On for Today's call card and Support; off on the onboarding done screen, which just asked.
  assert.match(read('src/components/today/SituationCard.tsx'), /<FamilySquaresSeatPanel[\s\S]*?onDecline=\{onDecline\}\s+reminderAsk\s+\/>/);
  assert.match(read('app/(tabs)/support.tsx'), /<FamilySquaresSeatPanel[\s\S]*?onDecline=\{\(\) => declineRsvp\(sess\)\}\s+reminderAsk\s+\/>/);
  const onboarding = read('app/(onboarding)/notifications.tsx');
  assert.doesNotMatch(/<FamilySquaresSeatPanel[\s\S]*?\/>/.exec(onboarding)?.[0] ?? 'reminderAsk', /reminderAsk/);
  // Onboarding notes its day, so Today's second chance stays away on it.
  assert.match(onboarding, /await markOnboarded\(user\.id\);[\s\S]*?void rememberReminderAsk\(user\.id, \{ onboardedAt: new Date\(\)\.toISOString\(\) \}\);/);
});

test('Today shows its second chance under the call card, not on the bereaved Today or a welcome-back visit', () => {
  const screen = read('app/(tabs)/index.tsx');
  assert.match(screen, /useTodayReminderAsk\(bereaved \|\| bereavedUnknown \? null : user\?\.id \?\? null, user\?\.joinedAt, !welcome\.ready \|\| welcome\.returned\)/);
  assert.match(screen, /const reminderAskCard = <ReminderAskNote ask=\{reminderAsk\} place="today" \/>;/);
  const screens = screen.split('<ScreenContainer').slice(1);
  assert.equal(screens.filter((part) => /\{mondayCallCard\}\s*\{reminderAskCard\}/.test(part)).length, 2);
  assert.ok(screens.filter((part) => part.includes('<GriefCard')).every((part) => !part.includes('{reminderAskCard}')));
  const hook = read('src/hooks/useReminderAsk.ts');
  assert.match(hook, /if \(kind && memory && startsTodayShowing\(memory, now\)\) \{\s*await rememberReminderAsk\(accountId, \{ todayShownAt: now\.toISOString\(\) \}\);/);
  assert.match(hook, /welcomeBackShowing: holdBack,/);
});

test('the ask is one sentence with labelled buttons, in both languages', () => {
  const note = read('src/components/reminders/ReminderAskNote.tsx');
  assert.equal((note.match(/<TouchableOpacity/g) ?? []).length, 2);
  assert.equal((note.match(/accessibilityRole="button"/g) ?? []).length, 2);
  assert.match(note, /accessibilityLabel=\{primary\.label\}/);
  assert.match(note, /accessibilityLabel=\{t\('reminderAsk\.notNowLabel'\)\}/);
  // Under a saved seat the "off in Settings" line is just the line and its button.
  assert.match(note, /const dismissible = view === 'ask' \|\| \(onToday && view === 'settings'\);/);
  const en = JSON.parse(read('src/locales/en/common.json')).reminderAsk as Record<string, string>;
  const es = JSON.parse(read('src/locales/es/common.json')).reminderAsk as Record<string, string>;
  assert.deepEqual(Object.keys(es), Object.keys(en));
  for (const key of ['seatBody', 'todayBody', 'remindMe', 'remindMeLabel', 'notNow', 'notNowLabel', 'settingsBody', 'openSettings', 'openSettingsLabel', 'on', 'failed', 'tryAgain', 'tryAgainLabel']) {
    assert.ok(en[key] && es[key], key);
    assert.match(note, new RegExp(`reminderAsk\\.${key}`));
  }
  assert.equal(en.remindMe, 'Remind me');
  assert.equal(en.notNow, 'Not now');
  assert.match(en.seatBody, /an hour before/);
  assert.match(en.seatBody, /tap-to-join when it starts/);
  // Never a price, never guilt.
  for (const copy of [en, es]) assert.doesNotMatch(Object.values(copy).join(' '), /\$|haven't|missed|a while|perdiste|hace tiempo/i);
});
