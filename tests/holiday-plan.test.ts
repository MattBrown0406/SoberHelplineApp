import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  defaultHolidayPlan,
  HOLIDAY_COMMITMENTS,
  HOLIDAY_DETAIL_LIMIT,
  HOLIDAY_INPUT_MAX_LENGTH,
  HOLIDAY_INVITATIONS,
  HOLIDAY_PROTECTED_BYTE_LIMIT,
  holidayPlanProgress,
  holidayPlanProtectedByteLength,
  holidayPlanIsThisSeason,
  holidayPlanShareText,
  holidayPlanStarted,
  holidaySeason,
  parseHolidayPlan,
  updateHolidayPlan,
} from '../src/lib/holidayPlan';
import { holidayPlanStorageKey } from '../src/lib/holidayPlanStorageKeys';
import {
  holidayCardStorageKey,
  holidayCardVisible,
  LOVED_ONE_CHECK_SNOOZE_DAYS,
  lovedOneCheckDue,
  lovedOneCheckSnoozeUntil,
  lovedOneCheckStorageKey,
} from '../src/lib/todayPrompts';
import { accountLocalKeys } from '../src/lib/accountLocalKeys';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(resolve(TEST_DIR, '..', path), 'utf8');

function completePlan() {
  let plan = updateHolidayPlan(defaultHolidayPlan(), {
    occasion: 'Thanksgiving at my sister’s, 3 PM',
    invitation: 'invited',
    terms: 'Welcome if you come sober.',
    ifTermsBreak: 'Dad walks them to the car.',
    relatives: 'We are not getting into it today.',
    ownExit: 'I drive myself.',
  });
  for (const id of HOLIDAY_COMMITMENTS) {
    plan = updateHolidayPlan(plan, { commitments: { ...plan.commitments, [id]: true } });
  }
  return plan;
}

test('a holiday plan is not ready until the invitation is decided and every agreement is confirmed', () => {
  const empty = holidayPlanProgress(defaultHolidayPlan());
  assert.equal(empty.ready, false);
  assert.ok(empty.missing.includes('invitation'));
  assert.ok(empty.missing.includes('ifTermsBreak'));
  assert.equal(holidayPlanStarted(defaultHolidayPlan()), false);

  const plan = completePlan();
  assert.equal(holidayPlanProgress(plan).ready, true);
  assert.equal(holidayPlanStarted(plan), true);
  for (const id of HOLIDAY_COMMITMENTS) {
    const changed = updateHolidayPlan(plan, { commitments: { ...plan.commitments, [id]: false } });
    assert.equal(holidayPlanProgress(changed).ready, false, id);
  }
  for (const key of ['occasion', 'terms', 'ifTermsBreak', 'relatives', 'ownExit'] as const) {
    assert.equal(holidayPlanProgress(updateHolidayPlan(plan, { [key]: '   ' })).ready, false, key);
  }
  // Kids and gift are optional.
  assert.equal(holidayPlanProgress(updateHolidayPlan(plan, { kids: '', gift: '' })).ready, true);
  // An unknown invitation reads as undecided.
  const bogus = updateHolidayPlan(plan, { invitation: 'maybe' as never });
  assert.equal(bogus.invitation, '');
  assert.equal(holidayPlanProgress(bogus).ready, false);
});

test('every invitation choice has its own terms label', () => {
  for (const lang of ['en', 'es']) {
    const copy = JSON.parse(read(`src/locales/${lang}/holidayPlan.json`));
    for (const choice of HOLIDAY_INVITATIONS) {
      assert.ok(copy.invitations[choice].label, `${lang} ${choice}`);
      assert.ok(copy.invitations[choice].termsLabel, `${lang} ${choice}`);
      assert.ok(copy.invitations[choice].termsPlaceholder, `${lang} ${choice}`);
    }
  }
});

test('stored plans normalize oversized values and fail closed when truncated', () => {
  const parsed = parseHolidayPlan(JSON.stringify({
    ...completePlan(),
    terms: 'x'.repeat(500),
    commitments: { ...completePlan().commitments, noCash: false, unknownRule: true },
  }));
  assert.equal(parsed.terms.length, HOLIDAY_DETAIL_LIMIT);
  assert.equal((parsed.commitments as Record<string, boolean>).unknownRule, undefined);
  assert.equal(parsed.commitments.noCash, false);
  assert.equal(parseHolidayPlan(null).invitation, '');
  assert.throws(() => parseHolidayPlan(''), /invalid_json/);
  assert.throws(() => parseHolidayPlan('{}'), /missing_field/);
  // An agreement added in a later build reads as unchecked; a damaged value fails closed.
  const older = parseHolidayPlan(JSON.stringify({ ...completePlan(), commitments: { noCash: true } }));
  assert.equal(older.commitments.noCash, true);
  assert.equal(older.commitments.safetyFirst, false);
  assert.equal(holidayPlanProgress(older).ready, false);
  assert.throws(() => parseHolidayPlan(JSON.stringify({ ...completePlan(), commitments: { ...completePlan().commitments, noCash: 'yes' } })), /invalid_commitment:noCash/);
  assert.throws(() => parseHolidayPlan(JSON.stringify({ ...completePlan(), gift: 12 })), /invalid_field:gift/);
  assert.throws(() => parseHolidayPlan(JSON.stringify({ ...completePlan(), invitation: 'maybe' })), /invalid_invitation/);
  assert.throws(() => parseHolidayPlan(JSON.stringify({ ...completePlan(), updatedAt: {} })), /invalid_updated_at/);
});

test('a full plan stays under the SecureStore budget, even in Spanish', () => {
  assert.ok(HOLIDAY_PROTECTED_BYTE_LIMIT < 2048);
  const typed = 'á'.repeat(HOLIDAY_INPUT_MAX_LENGTH);
  let plan = completePlan();
  for (const key of ['occasion', 'terms', 'ifTermsBreak', 'relatives', 'ownExit', 'kids', 'gift'] as const) {
    plan = updateHolidayPlan(plan, { [key]: typed });
  }
  assert.ok(holidayPlanProtectedByteLength(plan) <= HOLIDAY_PROTECTED_BYTE_LIMIT);
  assert.equal(holidayPlanProgress(plan).ready, true);
  assert.doesNotThrow(() => parseHolidayPlan(JSON.stringify(plan)));
  // Plain English at the input limit fits without trimming.
  let english = completePlan();
  for (const key of ['occasion', 'terms', 'ifTermsBreak', 'relatives', 'ownExit', 'kids', 'gift'] as const) {
    english = updateHolidayPlan(english, { [key]: 'x'.repeat(HOLIDAY_INPUT_MAX_LENGTH) });
  }
  for (const key of ['occasion', 'terms', 'ifTermsBreak', 'relatives', 'ownExit', 'kids', 'gift'] as const) {
    assert.equal(english[key].length, HOLIDAY_INPUT_MAX_LENGTH, key);
  }
});

test('a plan saved at the budget still opens after a newer agreement is added', () => {
  let plan = completePlan();
  for (const key of ['occasion', 'terms', 'ifTermsBreak', 'relatives', 'ownExit', 'kids', 'gift'] as const) {
    plan = updateHolidayPlan(plan, { [key]: 'é'.repeat(150) });
  }
  // Simulate the older build: one agreement key missing, the rest of the
  // budget filled, plus a padded answer so the record sits over the cap.
  const { medicalEmergency: _dropped, ...olderCommitments } = plan.commitments;
  const older = { ...plan, commitments: olderCommitments, gift: `${plan.gift}${'x'.repeat(80)}` };
  const opened = parseHolidayPlan(JSON.stringify(older));
  assert.ok(holidayPlanProtectedByteLength(opened) <= HOLIDAY_PROTECTED_BYTE_LIMIT);
  assert.equal(opened.commitments.medicalEmergency, false);
});

test('a full plan never throws when an agreement or the invitation changes', () => {
  let plan = completePlan();
  for (const key of ['occasion', 'terms', 'ifTermsBreak', 'relatives', 'ownExit', 'kids', 'gift'] as const) {
    plan = updateHolidayPlan(plan, { [key]: `${'🎄'.repeat(40)}\n`.repeat(3) });
  }
  for (const invitation of ['notThisYear', 'separateVisit', 'invited'] as const) {
    assert.doesNotThrow(() => { plan = updateHolidayPlan(plan, { invitation }); });
  }
  for (const id of HOLIDAY_COMMITMENTS) {
    assert.doesNotThrow(() => { plan = updateHolidayPlan(plan, { commitments: { ...plan.commitments, [id]: !plan.commitments[id] } }); });
  }
  assert.ok(holidayPlanProtectedByteLength(plan) <= HOLIDAY_PROTECTED_BYTE_LIMIT);
  assert.doesNotThrow(() => parseHolidayPlan(JSON.stringify(plan)));
});

test('a plan from an earlier season does not count for this one', () => {
  const plan = updateHolidayPlan(completePlan(), {}, new Date(2026, 10, 20).toISOString());
  assert.equal(holidayPlanIsThisSeason(plan, new Date(2026, 11, 20)), true);
  assert.equal(holidayPlanIsThisSeason(plan, new Date(2027, 0, 5)), true);
  assert.equal(holidayPlanIsThisSeason(plan, new Date(2027, 10, 2)), false);
  assert.equal(holidayPlanIsThisSeason(defaultHolidayPlan(), new Date(2026, 10, 2)), false);
  assert.match(read('src/components/today/HolidayPlanTodayCard.tsx'), /const ready = thisSeason && holidayPlanProgress\(plan\)\.ready/);
  // On the screen, last season's finished plan can be kept for this year in one tap.
  const screen = read('app/holiday-plan.tsx');
  assert.match(screen, /const savedReady = progress\.ready && saveState === 'saved' && !fromLastSeason;/);
  assert.match(screen, /onPress=\{\(\) => update\(\{\}\)\}/);
  const kept = updateHolidayPlan(plan, {}, new Date(2027, 10, 3).toISOString());
  assert.equal(holidayPlanIsThisSeason(kept, new Date(2027, 10, 20)), true);
  assert.equal(holidayPlanProgress(kept).ready, true);
});

test('SecureStore keys are valid and account scoped', () => {
  const first = holidayPlanStorageKey('11111111-1111-4111-8111-111111111111');
  assert.notEqual(first, holidayPlanStorageKey('22222222-2222-4222-8222-222222222222'));
  assert.match(first, /^[A-Za-z0-9._-]+$/);
  assert.throws(() => holidayPlanStorageKey('account:unsafe'), /invalid_holiday_account_id/);
});

test('the shared text has what she wrote, the agreements she confirmed, and not her own way out', () => {
  const t = (key: string) => `[${key}]`;
  const plan = updateHolidayPlan(completePlan(), { kids: '', ownExit: 'PRIVATE EXIT' });
  const text = holidayPlanShareText(plan, t);
  assert.match(text, /\[shareHeading\]/);
  assert.match(text, /Thanksgiving at my sister’s/);
  assert.match(text, /\[invitations\.invited\.label\]/);
  assert.match(text, /\[invitations\.invited\.termsLabel\]\nWelcome if you come sober\./);
  assert.match(text, /\[commitments\.noCash\]/);
  assert.doesNotMatch(text, /PRIVATE EXIT/);
  assert.doesNotMatch(text, /\[fields\.kids\]/);
  // One line about the free app at the end, only when the screen passes the link.
  assert.doesNotMatch(text, /\[shareFooter\]/);
  const withFooter = holidayPlanShareText(plan, (key, options) => key === 'shareFooter' ? `FOOTER ${options?.url}` : `[${key}]`, 'https://soberhelpline.com');
  assert.match(withFooter, /\n\nFOOTER https:\/\/soberhelpline\.com$/);
  assert.match(read('app/holiday-plan.tsx'), /holidayPlanShareText\(plan, \(key, options\) => t\(key, options\), appUrl\)/);
  const unconfirmed = updateHolidayPlan(plan, { commitments: { ...plan.commitments, noCash: false } });
  assert.doesNotMatch(holidayPlanShareText(unconfirmed, t), /\[commitments\.noCash\]/);
});

test('the season runs November 1 to January 6, and January belongs to the season before', () => {
  assert.deepEqual(holidaySeason(new Date(2026, 9, 31, 23, 59)), { active: false, season: '2026' });
  assert.deepEqual(holidaySeason(new Date(2026, 10, 1, 0, 1)), { active: true, season: '2026' });
  assert.deepEqual(holidaySeason(new Date(2026, 11, 31, 12)), { active: true, season: '2026' });
  assert.deepEqual(holidaySeason(new Date(2027, 0, 6, 22)), { active: true, season: '2026' });
  assert.deepEqual(holidaySeason(new Date(2027, 0, 7, 0, 1)), { active: false, season: '2026' });
  assert.equal(holidaySeason(new Date(2027, 5, 1)).active, false);
});

test('the holiday card shows in season until the plan is ready or hidden for that season', () => {
  const nov = new Date(2026, 10, 10);
  assert.equal(holidayCardVisible({ now: nov, planReady: false, dismissedSeason: null }), true);
  assert.equal(holidayCardVisible({ now: nov, planReady: true, dismissedSeason: null }), false);
  assert.equal(holidayCardVisible({ now: nov, planReady: false, dismissedSeason: '2026' }), false);
  assert.equal(holidayCardVisible({ now: new Date(2027, 0, 2), planReady: false, dismissedSeason: '2026' }), false);
  // Hidden last year: back this year.
  assert.equal(holidayCardVisible({ now: nov, planReady: false, dismissedSeason: '2025' }), true);
  assert.equal(holidayCardVisible({ now: new Date(2026, 6, 4), planReady: false, dismissedSeason: null }), false);
});

test('the loved-one check asks when she never said, monthly, and sooner after a heavy check-in', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const base = { hasRecord: true, stage: 'active_use', updatedAt: daysAgo(3), pressureScore: 2, snoozedUntil: null, now };
  assert.equal(lovedOneCheckDue({ ...base, hasRecord: false, stage: null }), 'missing');
  assert.equal(lovedOneCheckDue({ ...base, stage: null }), 'missing');
  assert.equal(lovedOneCheckDue(base), null);
  assert.equal(lovedOneCheckDue({ ...base, updatedAt: daysAgo(31) }), 'stale');
  assert.equal(lovedOneCheckDue({ ...base, updatedAt: 'garbage' }), 'stale');
  assert.equal(lovedOneCheckDue({ ...base, updatedAt: daysAgo(8), pressureScore: 4 }), 'pressure');
  assert.equal(lovedOneCheckDue({ ...base, updatedAt: daysAgo(8), pressureScore: 3 }), null);
  assert.equal(lovedOneCheckDue({ ...base, updatedAt: daysAgo(2), pressureScore: 5 }), null);
  // "Not now" holds for a week, then the question comes back.
  const snoozedUntil = lovedOneCheckSnoozeUntil(now);
  assert.equal(Date.parse(snoozedUntil) - now.getTime(), LOVED_ONE_CHECK_SNOOZE_DAYS * 86_400_000);
  assert.equal(lovedOneCheckDue({ ...base, hasRecord: false, stage: null, snoozedUntil }), null);
  const later = new Date(Date.parse(snoozedUntil) + 1000);
  assert.equal(lovedOneCheckDue({ ...base, hasRecord: false, stage: null, snoozedUntil, now: later }), 'missing');
  assert.equal(lovedOneCheckDue({ ...base, hasRecord: false, stage: null, snoozedUntil: 'garbage' }), 'missing');
});

test('a failed loved-one save keeps the question and its error on screen', () => {
  const card = read('src/components/today/LovedOneCheckCard.tsx');
  assert.match(card, /const reason = due \?\? \(saving \? lastReason\.current : null\)/);
  // "Not now" after a failed save hides the card.
  assert.match(card, /const until = lovedOneCheckSnoozeUntil\(new Date\(\)\);\s*setSaveError\(false\);/);
  // "Still the same" keeps the saved status.
  assert.match(card, /save\(current, true\)/);
  assert.match(read('app/(tabs)/index.tsx'), /saveLovedOne\(unchanged \? \{ stage \} : pathwayPhaseUpdate\(stage, lovedOneStatus\)\)/);
  assert.match(card, /setThanked\(false\)/);
  // A save failure must not read as an unreadable record (which hides the card).
  const hook = read('src/hooks/useLovedOne.ts');
  const save = hook.slice(hook.indexOf('const save = useCallback'), hook.indexOf('const setStatus = useCallback'));
  assert.doesNotMatch(save, /setLoadError/);
});

test('Today card flags are account scoped and purged with the account', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const keys = [holidayCardStorageKey(id), lovedOneCheckStorageKey(id), holidayCardStorageKey('22222222-2222-4222-8222-222222222222')];
  assert.deepEqual(accountLocalKeys(keys, [id]), keys.slice(0, 2));
  assert.match(read('src/lib/accountLocalData.ts'), /clearProtectedHolidayPlan\(accountId\)/);
});

test('route, localization, protected storage, Today and Tools entries are wired', () => {
  const route = read('app/holiday-plan.tsx');
  const storage = read('src/storage/holidayPlan.ts');
  const hook = read('src/hooks/useHolidayPlan.ts');
  const tools = read('app/(tabs)/learn.tsx');
  const today = read('app/(tabs)/index.tsx');
  const i18n = read('src/i18n/index.ts');
  const en = JSON.parse(read('src/locales/en/holidayPlan.json')) as Record<string, unknown>;
  const es = JSON.parse(read('src/locales/es/holidayPlan.json')) as Record<string, unknown>;
  const keys = (value: Record<string, unknown>, prefix = ''): string[] => Object.entries(value).flatMap(([key, row]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return row && typeof row === 'object' && !Array.isArray(row) ? keys(row as Record<string, unknown>, path) : [path];
  }).sort();
  assert.deepEqual(keys(en), keys(es));
  assert.match(route, /useToolOpened\('holiday_plan'\)/);
  assert.match(route, /logToolUsage\('holiday_plan', 'finished'\)/);
  assert.match(route, /accessibilityRole="checkbox"/);
  assert.match(route, /accessibilityRole="radio"/);
  assert.match(route, /maxLength=\{HOLIDAY_INPUT_MAX_LENGTH\}/);
  assert.match(route, /isSessionOnlyPlanStorage\(Platform\.OS\) \?[\s\S]{0,160}t\('webSessionNotice'\)/);
  assert.match(route, /shareOrCopy\(/);
  assert.doesNotMatch(route, /Alert\.alert\(/);
  assert.match(storage, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.match(storage, /choosePlanStore\(Platform\.OS, NativeSecureStore, globalThis\)/);
  assert.match(hook, /readVersion/);
  assert.match(hook, /bound\.accountId === accountId/);
  assert.match(tools, /router\.push\('\/holiday-plan'/);
  assert.match(today, /<HolidayPlanTodayCard accountId=/);
  assert.match(today, /<LovedOneCheckCard/);
  assert.match(today, /ready=\{!lovedOneLoading && !lovedOneLoadError\}/);
  assert.match(i18n, /holidayPlan: enHolidayPlan/);
  assert.match(i18n, /holidayPlan: esHolidayPlan/);
});
