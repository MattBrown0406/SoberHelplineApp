import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultHomecomingWeekPlan,
  dischargeReadiness,
  homecomingFitKey,
  homecomingHousingOptions,
  homecomingProgress,
  HOMECOMING_ITEMS,
  isHomecomingItemComplete,
  updateHomecomingDischarge,
  updateHomecomingIdentity,
  updateHomecomingItem,
} from '../src/lib/homecomingWeek';

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
  plan = updateHomecomingDischarge(plan, { adultReturnHomeQuote: 'Return to family home with parents.' });
  assert.equal(dischargeReadiness(plan).ready, true);
  assert.ok(homecomingHousingOptions(plan).includes('family_home'));
});

test('adult parent wording in notes cannot bypass the control', () => {
  let plan = completeDischarge(true);
  plan = updateHomecomingDischarge(plan, {
    housingType: 'other',
    housingDetails: 'Live with mom and dad for now',
    adultReturnHomeConfirmed: false,
  });
  const result = dischargeReadiness(plan);
  assert.equal(result.housingBlocked, true);
  assert.equal(result.ready, false);
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
