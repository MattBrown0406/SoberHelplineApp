import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  WELCOME_BACK_AFTER_DAYS,
  isReturnAfterAbsence,
  lastOpenedStorageKey,
  welcomeBackActions,
} from '../src/lib/welcomeBack';
import { accountLocalKeys } from '../src/lib/accountLocalKeys';

const read = (file: string) => readFileSync(file, 'utf8');
const DAY = 86_400_000;
const now = new Date('2026-11-13T18:00:00Z');
const ago = (days: number) => new Date(now.getTime() - days * DAY).toISOString();

test('welcome back shows after seven or more days away, and not before', () => {
  assert.equal(WELCOME_BACK_AFTER_DAYS, 7);
  assert.equal(isReturnAfterAbsence(ago(7), now), true);
  assert.equal(isReturnAfterAbsence(ago(30), now), true);
  assert.equal(isReturnAfterAbsence(new Date(now.getTime() - 7 * DAY + 60_000).toISOString(), now), false);
  assert.equal(isReturnAfterAbsence(ago(1), now), false);
  assert.equal(isReturnAfterAbsence(ago(0), now), false);
});

test('no record of a last visit is not a return: a new member is never "welcomed back"', () => {
  assert.equal(isReturnAfterAbsence(null, now), false);
  assert.equal(isReturnAfterAbsence(undefined, now), false);
  assert.equal(isReturnAfterAbsence('', now), false);
  assert.equal(isReturnAfterAbsence('not a date', now), false);
  // A clock that went backwards is not a return either.
  assert.equal(isReturnAfterAbsence(new Date(now.getTime() + 30 * DAY).toISOString(), now), false);
});

test('the card offers only what is useful right now', () => {
  assert.deepEqual(welcomeBackActions({ seatOpen: true, checkedInToday: false }), ['saveSeat', 'checkIn']);
  // Her seat is already saved (or she said she can't make it): no seat button.
  assert.deepEqual(welcomeBackActions({ seatOpen: false, checkedInToday: false }), ['checkIn']);
  assert.deepEqual(welcomeBackActions({ seatOpen: true, checkedInToday: true }), ['saveSeat']);
  assert.deepEqual(welcomeBackActions({ seatOpen: false, checkedInToday: true }), []);
});

test('the last-opened time is kept per account, so deleting the account removes it', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  assert.deepEqual(accountLocalKeys([lastOpenedStorageKey(id), lastOpenedStorageKey(other)], [id]), [lastOpenedStorageKey(id)]);
});

test('the hook welcomes a return once: it reads the last visit, then writes this one', () => {
  const hook = read('src/hooks/useWelcomeBack.ts');
  assert.match(hook, /const last = await AsyncStorage\.getItem\(key\);[\s\S]*?await AsyncStorage\.setItem\(key, now\.toISOString\(\)\);[\s\S]*?isReturnAfterAbsence\(last, now\)/);
  // A week in the background counts too, not only a fresh launch.
  assert.match(hook, /AppState\.addEventListener\('change', \(state\) => \{\s*if \(state === 'active'\) void start\(\);/);
  assert.match(hook, /pending \?\?= look\(\);/);
  assert.match(hook, /const dismiss = useCallback\(\(\) => \{\s*live\.current\.visible = false;\s*setVisible\(false\);\s*\}, \[\]\);/);
  // Today's reminder ask waits for the welcome-back answer on every return (welcome-back-hook.test.mjs runs it).
  assert.match(read('app/(tabs)/index.tsx'), /!welcome\.ready \|\| welcome\.returned, welcome\.decided\)/);
  assert.match(read('src/hooks/useReminderAsk.ts'), /const welcomed = welcomeBackDecided \? await welcomeBackDecided\(\)\.catch\(\(\) => false\) : false;[\s\S]*?const kind = welcomed \? null : decide\(permission, memory, now\);/);
});

test('Today shows the card at the top; either action or Close puts it away', () => {
  const today = read('app/(tabs)/index.tsx');
  const screens = today.split('<ScreenContainer').slice(1).filter((screen) => screen.includes('{checkInCard}') && !screen.includes('<GriefCard'));
  assert.equal(screens.length, 2);
  for (const screen of screens) {
    assert.match(screen, /\{header\}\s*\{welcomeBackCard\}\s*\{mondayCallCard\}/);
    assert.match(screen, /scrollRef=\{scrollRef\}/);
    assert.match(screen, /<View onLayout=\{onCheckInLayout\}>\s*\{checkInCard\}/);
  }
  assert.match(today, /const welcomeBackCard = welcome\.visible \? \(/);
  // "Save my seat" reuses the call card's own reserve action.
  assert.match(today, /onSaveSeat=\{\(\) => \{\s*welcome\.dismiss\(\);\s*void rsvpFreeCall\(\);\s*\}\}/);
  assert.match(today, /onCheckIn=\{\(\) => \{\s*scrollToCheckIn\.current = true;\s*welcome\.dismiss\(\);\s*\}\}/);
  assert.match(today, /onDismiss=\{welcome\.dismiss\}/);
  assert.match(today, /scrollRef\.current\?\.scrollTo\(\{ y: Math\.max\(0, checkInY\.current - 8\), animated: true \}\)/);
  // Only a meeting she has not answered for is offered.
  assert.match(today, /const seatOpen = !!nextFreeCall && \(isFamilySquaresSession\(nextFreeCall\) \|\| isLaSobremesaSession\(nextFreeCall\)\)\s*&& !nextFreeCall\.rsvped && !nextFreeCall\.declined;/);
});

test('the card is warm and plain: no streaks, no "missed", no numbers, and every button is labelled', () => {
  const card = read('src/components/today/WelcomeBackCard.tsx');
  assert.equal((card.match(/<TouchableOpacity/g) ?? []).length, 3);
  assert.equal((card.match(/accessibilityRole="button"/g) ?? []).length, 3);
  for (const label of ['saveSeatLabel', 'checkInLabel', 'dismissLabel']) {
    assert.match(card, new RegExp(`accessibilityLabel=\\{t\\('welcomeBack\\.${label}'\\)\\}`));
  }
  assert.doesNotMatch(card, />\s*[A-Za-z][^<{]*[a-z]{3,}[^<{]*</, 'no hard-coded copy');
  const en = JSON.parse(read('src/locales/en/today.json')).welcomeBack as Record<string, string>;
  const es = JSON.parse(read('src/locales/es/today.json')).welcomeBack as Record<string, string>;
  assert.equal(en.title, 'Good to see you');
  assert.deepEqual(Object.keys(es), Object.keys(en));
  for (const copy of [en, es]) {
    const text = Object.values(copy).join(' ');
    assert.doesNotMatch(text, /\d/, 'no numbers');
    assert.doesNotMatch(text, /streak|racha|miss|haven't|have not|a while|away|perdiste|faltaste|hace tiempo|ausen/i, 'never guilt');
  }
});
