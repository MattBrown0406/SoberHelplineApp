import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  defaultHomecomingWeekPlan,
  dischargeReadiness,
  homecomingFitKey,
  homecomingHousingOptions,
  homecomingProgress,
  HOMECOMING_ITEMS,
  isHomecomingItemComplete,
  parseHomecomingWeekPlan,
  updateHomecomingDischarge,
  updateHomecomingIdentity,
  updateHomecomingItem,
} from '../src/lib/homecomingWeek';
import {
  homecomingDischargeStorageKey,
  homecomingIdentityStorageKey,
  homecomingItemStorageKey,
} from '../src/lib/homecomingStorageKeys';
import {
  parseProtectedHomecomingHousingRecord,
  parseProtectedHomecomingRecord,
} from '../src/lib/homecomingProtectedRecord';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function completeDischarge(adult = true) {
  let plan = defaultHomecomingWeekPlan();
  plan = updateHomecomingIdentity(plan, {
    preferredName: 'Sam',
    ageBand: adult ? 'adult' : 'under_18',
    exactAge: adult ? '32' : '16',
    gender: 'prefer_not_to_say',
  });
  plan = updateHomecomingDischarge(plan, {
    facilityName: 'Care program',
    dischargeDate: '2026-08-20',
    level: 'residential',
    housingType: adult ? 'sober_living' : 'family_home',
    housingDetails: adult ? 'Oak House, Bend' : 'Guardian home, Bend',
    otherHousingFamilyStatus: adult ? 'not_family' : '',
    receivingAdult: adult ? '' : 'Jordan',
    soberLivingStatus: adult ? 'named' : 'none_named',
    soberLivingName: adult ? 'Oak House' : '',
    soberLivingCity: adult ? 'Bend' : '',
    soberLivingPhone: adult ? '503-555-0100' : '',
    soberLivingStartDate: adult ? '2026-08-20' : '',
    soberLivingRules: adult ? '10 PM curfew' : '',
    outpatientStatus: 'named',
    outpatientName: 'Path IOP',
    outpatientStartDate: '2026-08-21',
    outpatientSchedule: 'Mon Wed Fri at 9 AM',
    outpatientTransport: 'Jordan drives; Casey backup',
    fellowship: 'aa',
    meetingsKnown: 'yes',
    firstMeetings: 'Friday 7 PM and Saturday 10 AM',
    meetingPlace: '123 Main St',
    backupMeeting: 'Sunday 6 PM online',
    employmentStatus: 'not_yet',
    employmentHelper: 'Case manager Jordan',
    aftercareStatus: 'named',
    aftercareName: 'Taylor, alumni coordinator',
    aftercareContact: '503-555-0199',
    medicationStatus: 'yes',
    medicationListHolder: 'Jordan holds the discharge list',
  });
  return plan;
}

test('identity cannot be skipped before discharge can become ready', () => {
  const result = dischargeReadiness(defaultHomecomingWeekPlan());
  assert.equal(result.ready, false);
  assert.ok(result.missing.includes('identity.preferredName'));
  assert.ok(result.missing.includes('identity.ageBand'));
  assert.ok(result.missing.includes('identity.gender'));
});

test('under 18 permits a guardian home but requires a receiving adult', () => {
  let plan = completeDischarge(false);
  assert.ok(homecomingHousingOptions(plan).includes('family_home'));
  assert.equal(dischargeReadiness(plan).ready, true);
  plan = updateHomecomingDischarge(plan, { receivingAdult: '' });
  assert.equal(dischargeReadiness(plan).ready, false);
});

test('adult sober living is valid and parent home is hidden by default', () => {
  const plan = completeDischarge(true);
  assert.equal(dischargeReadiness(plan).ready, true);
  assert.ok(homecomingHousingOptions(plan).includes('sober_living'));
  assert.ok(!homecomingHousingOptions(plan).includes('family_home'));
});

test('adult parent home requires explicit discharge control and quoted language', () => {
  let plan = completeDischarge(true);
  plan = updateHomecomingDischarge(plan, { housingType: 'family_home', housingDetails: 'Parents house' });
  assert.equal(dischargeReadiness(plan).housingBlocked, true);
  plan = updateHomecomingDischarge(plan, { adultReturnHomeConfirmed: true });
  assert.equal(dischargeReadiness(plan).ready, false);
  plan = updateHomecomingDischarge(plan, { adultReturnHomeQuote: 'Follow the written discharge plan.' });
  assert.equal(dischargeReadiness(plan).ready, false);
  plan = updateHomecomingDischarge(plan, { adultReturnHomeQuote: 'Do not return to parents after discharge.' });
  assert.equal(dischargeReadiness(plan).ready, false);
  plan = updateHomecomingDischarge(plan, { adultReturnHomeQuote: 'No debe volver a la casa familiar.' });
  assert.equal(dischargeReadiness(plan).ready, false);
  plan = updateHomecomingDischarge(plan, { adultReturnHomeQuote: 'Return to family home with parents.' });
  assert.equal(dischargeReadiness(plan).ready, false);
  assert.ok(!homecomingHousingOptions(plan).includes('family_home'));
  plan = updateHomecomingDischarge(plan, { adultReturnHomeQuoteAffirmed: true, otherHousingFamilyStatus: 'family_or_relative' });
  assert.equal(dischargeReadiness(plan).ready, true);
  assert.ok(homecomingHousingOptions(plan).includes('family_home'));
});

test('adult family destinations in English or Spanish notes cannot bypass a false category', () => {
  for (const housingDetails of [
    "My sister's house", "My daughter's house", "My daughter Jane's house", "My niece's place", "Guardian's apartment", 'Stay with my son',
    'Casa de mi hermano', 'Casa de la abuela durante un mes', 'Vivir con mi hija', 'Casa de mi sobrino', 'Stay with my folks',
  ]) {
    let plan = completeDischarge(true);
    plan = updateHomecomingDischarge(plan, {
      housingType: 'other',
      housingDetails,
      otherHousingFamilyStatus: 'not_family',
      adultReturnHomeConfirmed: false,
    });
    const result = dischargeReadiness(plan);
    assert.equal(result.housingBlocked, true);
    assert.equal(result.ready, false);
  }
});

test('other housing requires an explicit family-or-relative classification', () => {
  let plan = completeDischarge(true);
  plan = updateHomecomingDischarge(plan, { housingType: 'other', housingDetails: 'Oxford Hotel, room reserved' });
  assert.equal(dischargeReadiness(plan).ready, false);
  plan = updateHomecomingDischarge(plan, { otherHousingFamilyStatus: 'not_family' });
  assert.equal(dischargeReadiness(plan).ready, true);
  plan = updateHomecomingDischarge(plan, { otherHousingFamilyStatus: 'family_or_relative' });
  assert.equal(dischargeReadiness(plan).housingBlocked, true);
});

test('every adult housing category requires an explicit family-or-relative classification', () => {
  for (const housingType of ['sober_living', 'own_home', 'partner', 'friend'] as const) {
    let plan = completeDischarge(true);
    plan = updateHomecomingDischarge(plan, { housingType, otherHousingFamilyStatus: '' });
    assert.equal(dischargeReadiness(plan).ready, false, housingType);
    plan = updateHomecomingDischarge(plan, { otherHousingFamilyStatus: 'not_family' });
    assert.equal(dischargeReadiness(plan).ready, true, housingType);
    plan = updateHomecomingDischarge(plan, { otherHousingFamilyStatus: 'family_or_relative' });
    assert.equal(dischargeReadiness(plan).housingBlocked, true, housingType);
  }
});

test('changing an adult destination clears its prior family classification', () => {
  let plan = completeDischarge(true);
  plan = updateHomecomingDischarge(plan, { housingDetails: "My daughter Jane's house" });
  assert.equal(plan.discharge.otherHousingFamilyStatus, '');
  assert.equal(dischargeReadiness(plan).ready, false);
  assert.equal(dischargeReadiness(plan).housingBlocked, true);
});

test('day 0, first-weekend, and discharge notes cannot contradict adult housing', () => {
  let plan = completeDischarge(true);
  plan = updateHomecomingDischarge(plan, { otherInstructions: 'Return to parents home after discharge' });
  assert.equal(dischargeReadiness(plan).housingBlocked, true);
  plan = completeDischarge(true);
  plan = updateHomecomingItem(plan, 'day0_pickup', { place: "My aunt's house", details: 'Drive there after discharge' });
  assert.equal(dischargeReadiness(plan).housingBlocked, true);
  plan = completeDischarge(true);
  plan = updateHomecomingItem(plan, 'first_weekend', { place: 'Casa de mi prima', details: 'Dormir allí' });
  assert.equal(dischargeReadiness(plan).housingBlocked, true);
});

test('changing a minor to adult clears inherited family-home details', () => {
  let plan = completeDischarge(false);
  plan = updateHomecomingIdentity(plan, { ageBand: 'adult', exactAge: '19' });
  assert.equal(plan.discharge.housingType, '');
  assert.equal(plan.discharge.housingDetails, '');
  assert.equal(plan.discharge.receivingAdult, '');
  assert.ok(!homecomingHousingOptions(plan).includes('family_home'));
});

test('invalid calendar dates and unknown stored enums fail closed', () => {
  let plan = completeDischarge(true);
  plan = updateHomecomingDischarge(plan, { dischargeDate: '2026-02-31' });
  assert.equal(dischargeReadiness(plan).ready, false);
  const source = completeDischarge(true);
  const parsed = parseHomecomingWeekPlan(JSON.stringify({
    ...source,
    discharge: { ...source.discharge, housingType: 'parents_forever', level: 'vacation' },
  }));
  assert.equal(parsed.discharge.housingType, '');
  assert.equal(parsed.discharge.level, '');
  assert.equal(dischargeReadiness(parsed).ready, false);
});

test('age and gender alter optional-fit guidance without gendering family roles', () => {
  let plan = completeDischarge(true);
  plan = updateHomecomingIdentity(plan, { exactAge: '19', gender: 'woman' });
  assert.equal(homecomingFitKey(plan), 'young_adult_woman');
  plan = updateHomecomingIdentity(plan, { exactAge: '45', gender: 'man' });
  assert.equal(homecomingFitKey(plan), 'adult_man');
  assert.ok(HOMECOMING_ITEMS.every((item) => !/woman|man|mother|father/i.test(item.id)));
});

test('confirmed items require a named person, place, time, backup, and details', () => {
  let plan = completeDischarge(true);
  const definition = HOMECOMING_ITEMS[0];
  plan = updateHomecomingItem(plan, definition.id, { status: 'confirmed', details: 'Pickup arranged' });
  assert.equal(isHomecomingItemComplete(plan, definition), false);
  plan = updateHomecomingItem(plan, definition.id, {
    person: 'Jordan', place: 'Facility lobby', time: 'Aug 20, 10 AM', backup: 'Casey', details: 'Drive directly to Oak House',
  });
  assert.equal(isHomecomingItemComplete(plan, definition), true);
});

test('only contextually legitimate items can be not applicable', () => {
  let plan = completeDischarge(true);
  const employment = HOMECOMING_ITEMS.find((item) => item.id === 'employment_school')!;
  const pickup = HOMECOMING_ITEMS.find((item) => item.id === 'day0_pickup')!;
  plan = updateHomecomingItem(plan, employment.id, { status: 'not_applicable', details: 'Discharge plan says not yet' });
  plan = updateHomecomingItem(plan, pickup.id, { status: 'not_applicable', details: 'No pickup' });
  assert.equal(isHomecomingItemComplete(plan, employment), true);
  assert.equal(isHomecomingItemComplete(plan, pickup), false);
});

test('overall readiness requires discharge truth and every day 0-7 item', () => {
  let plan = completeDischarge(true);
  assert.equal(homecomingProgress(plan).ready, false);
  for (const definition of HOMECOMING_ITEMS) {
    const notApplicable = definition.id === 'employment_school';
    plan = updateHomecomingItem(plan, definition.id, notApplicable
      ? { status: 'not_applicable', details: 'Discharge plan says not yet' }
      : { status: 'confirmed', person: 'Jordan', place: 'Named place', time: 'Named time', backup: 'Casey', details: 'Specific plan' });
  }
  assert.equal(homecomingProgress(plan).ready, true);
});

test('present but malformed protected records fail closed', () => {
  assert.deepEqual(parseProtectedHomecomingRecord(null, 'identity', 'preferredName'), {});
  assert.throws(() => parseProtectedHomecomingRecord('{bad json', 'identity', 'preferredName'), /invalid_json/);
  assert.throws(() => parseProtectedHomecomingRecord('[]', 'identity', 'preferredName'), /invalid_shape/);
  assert.throws(() => parseProtectedHomecomingRecord('{}', 'identity', 'preferredName'), /missing_field/);
  assert.throws(() => parseProtectedHomecomingRecord('{"preferredName":"Sam"}', 'identity', ['preferredName', 'ageBand']), /missing_field/);
  assert.deepEqual(parseProtectedHomecomingRecord('{"preferredName":"Sam"}', 'identity', 'preferredName'), { preferredName: 'Sam' });
});

test('legacy housing records migrate only the two known new fields', () => {
  const legacy = JSON.stringify({
    housingType: 'sober_living', housingDetails: 'Oak House', receivingAdult: '',
    adultReturnHomeConfirmed: false, adultReturnHomeQuote: '',
  });
  assert.deepEqual(parseProtectedHomecomingHousingRecord(legacy), {
    housingType: 'sober_living', housingDetails: 'Oak House', receivingAdult: '',
    adultReturnHomeConfirmed: false, adultReturnHomeQuote: '',
    otherHousingFamilyStatus: '', adultReturnHomeQuoteAffirmed: false,
  });
  assert.throws(() => parseProtectedHomecomingHousingRecord(JSON.stringify({
    housingType: 'sober_living', receivingAdult: '', adultReturnHomeConfirmed: false, adultReturnHomeQuote: '',
  })), /missing_field.*housingDetails/);
});

test('protected storage and hook preserve account scope and clear/read/write coordination', () => {
  assert.notEqual(homecomingIdentityStorageKey('account-a'), homecomingIdentityStorageKey('account-b'));
  assert.notEqual(homecomingDischargeStorageKey('account-a', 'housing'), homecomingDischargeStorageKey('account-b', 'housing'));
  assert.notEqual(homecomingItemStorageKey('account-a', 'day0_pickup'), homecomingItemStorageKey('account-b', 'day0_pickup'));
  const storage = readFileSync(resolve(TEST_DIR, '../src/storage/homecomingWeek.ts'), 'utf8');
  const hook = readFileSync(resolve(TEST_DIR, '../src/hooks/useHomecomingWeek.ts'), 'utf8');
  assert.match(storage, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.match(storage, /SecureStore\.deleteItemAsync/);
  assert.match(hook, /clearing: boolean/);
  assert.match(hook, /\+\+coordinator\.readVersion/);
  assert.match(hook, /readVersion !== coordinator\.readVersion \|\| coordinator\.clearing/);
  assert.match(hook, /if \(coordinator\.clearing\) return/);
});

test('route keeps safety exceptions visible in loading, storage-error, and normal states', () => {
  const route = readFileSync(resolve(TEST_DIR, '../app/homecoming-week.tsx'), 'utf8');
  assert.equal((route.match(/<SafetyExceptions \/>/g) ?? []).length, 3);
  assert.match(route, /tel:911/);
  assert.match(route, /tel:988/);
  assert.match(route, /saveState === 'saved'/);
  assert.match(route, /adultReturnHomeConfirmed/);
  assert.match(route, /adultReturnHomeQuote/);
  assert.match(route, /accessibilityRole="radio"/);
});

test('English and Spanish Homecoming Week keys match and Tools links the sibling workflow', () => {
  const en = JSON.parse(readFileSync(resolve(TEST_DIR, '../src/locales/en/homecomingWeek.json'), 'utf8')) as Record<string, unknown>;
  const es = JSON.parse(readFileSync(resolve(TEST_DIR, '../src/locales/es/homecomingWeek.json'), 'utf8')) as Record<string, unknown>;
  const keys = (value: Record<string, unknown>, prefix = ''): string[] => Object.entries(value).flatMap(([key, row]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return row && typeof row === 'object' && !Array.isArray(row) ? keys(row as Record<string, unknown>, path) : [path];
  }).sort();
  assert.deepEqual(keys(en), keys(es));
  const tools = readFileSync(resolve(TEST_DIR, '../app/(tabs)/learn.tsx'), 'utf8');
  assert.match(tools, /router\.push\('\/homecoming-week'/);
  assert.match(tools, /tools\.homecomingTitle/);
});
