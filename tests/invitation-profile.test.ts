import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  addProfileItem,
  cleanProfileItem,
  emptyLovedOneProfile,
  inferSoberTimes,
  isProfileComplete,
  isSafetySerious,
  mergeSoberTimes,
  PROFILE_ITEM_MAX,
  PROFILE_LIST_LIMIT,
  prefillSoberTimes,
  profileFromRow,
  profileHasSubstance,
  profileToPayload,
  removeProfileItem,
} from '../src/lib/lovedOneProfile';
import {
  prefillProfile,
  previousWeekStart,
  setupSteps,
  STEP_FIELD,
  suggestionKeys,
  SUGGESTIONS,
  TRACKER_SEEDS,
} from '../src/lib/invitationSetup';

const en = JSON.parse(readFileSync('src/locales/en/invitation.json', 'utf8'));
const es = JSON.parse(readFileSync('src/locales/es/invitation.json', 'utf8'));
const tracker = JSON.parse(readFileSync('src/locales/en/tracker.json', 'utf8'));

test('the profile type keeps the fields conversation practice reads', () => {
  const profile = emptyLovedOneProfile();
  for (const key of ['name', 'relationship', 'substances', 'useTriggers', 'whatUseGives', 'costsTheyFeel',
    'soberMoments', 'usualPhrases', 'recentIncidents', 'safetyConcern', 'updatedAt']) {
    assert.ok(key in profile, key);
  }
  assert.equal(profileHasSubstance(profile), false);
  assert.equal(profileHasSubstance({ ...profile, usualPhrases: ['Not now.'] }), true);
});

test('list items are cleaned, de-duplicated and capped', () => {
  assert.equal(cleanProfileItem('  Friday\n  nights \u0007'), 'Friday nights');
  assert.equal(cleanProfileItem('x'.repeat(400)).length, PROFILE_ITEM_MAX);
  let list: string[] = [];
  list = addProfileItem(list, 'After work');
  list = addProfileItem(list, 'after WORK');
  list = addProfileItem(list, '   ');
  assert.deepEqual(list, ['After work']);
  for (let i = 0; i < 10; i += 1) list = addProfileItem(list, `item ${i}`);
  assert.equal(list.length, PROFILE_LIST_LIMIT);
  assert.deepEqual(removeProfileItem(['a', 'b'], 'a'), ['b']);
});

test('database rows map to the profile and junk is rejected', () => {
  assert.equal(profileFromRow(null), null);
  assert.equal(profileFromRow({ name: 'no account id' }), null);
  const profile = profileFromRow({
    account_id: 'a',
    name: 'Mike',
    relationship: 'son',
    substances: ['alcohol', 7],
    use_triggers: ['Friday nights'],
    sober_moments: ['Saturday mornings'],
    sober_times: ['weekend', 'midnight'],
    safety_concern: 'serious',
    completed_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
  });
  assert.ok(profile);
  assert.deepEqual(profile.substances, ['alcohol']);
  assert.deepEqual(profile.soberTimes, ['weekend']);
  assert.equal(isSafetySerious(profile), true);
  assert.equal(isProfileComplete(profile), true);
  assert.equal(profileFromRow({ account_id: 'a', safety_concern: 'maybe' })?.safetyConcern, '');
});

test('the save payload keeps exactly the selected sober times (a deselected bucket stays off)', () => {
  const payload = profileToPayload({
    ...emptyLovedOneProfile(),
    name: '  Mike  ',
    soberMoments: ['Saturday mornings', 'por la noche después de cenar'],
    soberTimes: ['afternoon', 'bogus' as never],
  });
  assert.equal(payload.name, 'Mike');
  assert.deepEqual(payload.soberTimes, ['afternoon']);
  assert.deepEqual(profileToPayload({ ...emptyLovedOneProfile(), soberMoments: ['Weekend mornings'], soberTimes: [] }).soberTimes, []);
});

test('sober times are read from the family\'s own words in English and Spanish', () => {
  assert.deepEqual(inferSoberTimes(['Weekend mornings']), ['morning', 'weekend']);
  assert.deepEqual(inferSoberTimes(['los domingos', 'por la tarde']), ['afternoon', 'weekend']);
  assert.deepEqual(inferSoberTimes(['after work', 'before work']), ['morning', 'evening']);
  assert.deepEqual(inferSoberTimes(['on drives']), []);
  assert.deepEqual(inferSoberTimes(['I am calm']), []);
  // Meals and "night" say nothing reliable about when they're sober.
  assert.deepEqual(inferSoberTimes(['Sunday dinner']), ['weekend']);
  assert.deepEqual(inferSoberTimes(['late at night', 'over coffee', 'breakfast', 'la cena', 'mañana temprano']), []);
  assert.deepEqual(mergeSoberTimes(['evening'], ['morning', 'bogus']), ['morning', 'evening']);
});

test('inference only prefills an empty selection', () => {
  assert.deepEqual(prefillSoberTimes({ ...emptyLovedOneProfile(), soberMoments: ['Saturday mornings'] }).soberTimes, ['morning', 'weekend']);
  assert.deepEqual(prefillSoberTimes({ ...emptyLovedOneProfile(), soberMoments: ['Saturday mornings'], soberTimes: ['evening'] }).soberTimes, ['evening']);
  assert.deepEqual(prefillProfile({ ...emptyLovedOneProfile(), soberMoments: ['Sunday dinner'] }, null).soberTimes, ['weekend']);
  assert.deepEqual(prefillProfile({ ...emptyLovedOneProfile(), soberMoments: ['Sunday dinner'], soberTimes: ['evening'] }, null).soberTimes, ['evening']);
});

test('suggestion chips have EN/ES labels and tracker seeds point at real signs and chips', () => {
  for (const [field, keys] of Object.entries(SUGGESTIONS)) {
    for (const key of keys) {
      assert.ok(en.setup.suggestions[field][key], `en ${field}.${key}`);
      assert.ok(es.setup.suggestions[field][key], `es ${field}.${key}`);
    }
  }
  const signIds = new Set((tracker.warning.signs as Array<{ id: string }>).map((sign) => sign.id));
  for (const [sign, seeds] of Object.entries(TRACKER_SEEDS)) {
    assert.ok(signIds.has(sign), sign);
    for (const seed of seeds) assert.ok((SUGGESTIONS[seed.field] as readonly string[]).includes(seed.key), `${sign}→${seed.key}`);
  }
  assert.deepEqual(suggestionKeys('useTriggers', ['w-friends']).slice(0, 1), [{ key: 'oldFriends', fromTracker: true }]);
  assert.equal(suggestionKeys('useTriggers', ['w-friends']).filter((item) => item.key === 'oldFriends').length, 1);
  assert.deepEqual(suggestionKeys('recentIncidents', ['w-friends']), []);
});

test('setup steps: alerts only for paid members off the safety-first path', () => {
  assert.ok(setupSteps({ paid: true, safetySerious: false }).includes('alerts'));
  assert.ok(!setupSteps({ paid: false, safetySerious: false }).includes('alerts'));
  assert.ok(!setupSteps({ paid: true, safetySerious: true }).includes('alerts'));
  const steps = setupSteps({ paid: true, safetySerious: false });
  assert.equal(steps.indexOf('safety'), 2, 'safety screen comes before the pattern questions');
  for (const [step, field] of Object.entries(STEP_FIELD)) {
    assert.ok(en.setup[step]?.title && es.setup[step]?.title, `${step} copy`);
    assert.ok(field);
  }
});

test('prefill takes name, relationship and substances from loved_ones only where blank', () => {
  const fresh = prefillProfile(null, { first_name: ' Mike ', relationship: 'son', substances: ['alcohol'] });
  assert.equal(fresh.name, 'Mike');
  assert.equal(fresh.relationship, 'son');
  assert.deepEqual(fresh.substances, ['alcohol']);
  const saved = prefillProfile({ ...emptyLovedOneProfile(), name: 'Mikey' }, { first_name: 'Michael' });
  assert.equal(saved.name, 'Mikey');
  assert.equal(prefillProfile(null, null).name, '');
});

test('previous week start is the Monday a week before', () => {
  assert.equal(previousWeekStart('2026-10-02'), '2026-09-21');
  assert.equal(previousWeekStart('2026-10-05'), '2026-09-28');
  assert.equal(previousWeekStart('2026-10-04'), '2026-09-21');
});
