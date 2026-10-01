import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as client from '../src/lib/invitationForecast';
import * as server from '../supabase/functions/_shared/invitation-forecast';
import { normalizeRecoveryPhase, RECOVERY_PHASES } from '../src/lib/recoveryPathway';

const NOW = Date.parse('2026-10-02T22:00:00Z');

function input(overrides: Partial<client.ForecastInput> = {}): client.ForecastInput {
  return {
    nowMs: NOW,
    localHour: 17,
    localWeekday: 4,
    latestConsequenceAt: null,
    warningThisWeek: 0,
    warningLastWeek: 0,
    recoveryThisWeek: 0,
    recoveryLastWeek: 0,
    soberTimes: [],
    moveDaysLast7: 0,
    todayCheck: null,
    safetySerious: false,
    localDate: '2026-10-02',
    lastOutcome: null,
    lastOutcomeDate: null,
    nextWindowDate: null,
    recoveryPhase: null,
    ...overrides,
  };
}

// Deterministic pseudo-random generator so the parity sweep is reproducible.
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test('app and Edge Function forecast copies score every input identically', () => {
  const random = rng(42);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)];
  for (let i = 0; i < 4000; i += 1) {
    const hoursAgo = pick([null, -1, 0, 5, 30, 71, 72, 73, 200]);
    const sample = input({
      localHour: Math.floor(random() * 24),
      localWeekday: Math.floor(random() * 7),
      latestConsequenceAt: hoursAgo === null ? pick([null, 'not a date']) : new Date(NOW - hoursAgo * 3_600_000).toISOString(),
      warningThisWeek: Math.floor(random() * 6),
      warningLastWeek: Math.floor(random() * 6),
      recoveryThisWeek: Math.floor(random() * 6),
      recoveryLastWeek: Math.floor(random() * 6),
      soberTimes: ['morning', 'afternoon', 'evening', 'weekend', 'bogus'].filter(() => random() < 0.35),
      moveDaysLast7: Math.floor(random() * 9) - 1,
      todayCheck: pick([null, 'calm', 'okay', 'rough', 'junk']),
      safetySerious: random() < 0.05,
      lastOutcome: pick([null, null, 'yes', 'not_yet', 'angry', 'didnt_get_to_it', 'junk']),
      lastOutcomeDate: pick([null, '2026-10-01', '2026-09-01', 'junk']),
      nextWindowDate: pick([null, '2026-10-01', '2026-10-02', '2026-10-05', 'junk']),
      recoveryPhase: pick([null, null, 'in_treatment', 'returning_home', 'early_recovery_90', 'ongoing_recovery', 'return_to_use', 'active_use', 'junk']),
    });
    assert.deepEqual(client.scoreReceptivity(sample), server.scoreReceptivity(sample), JSON.stringify(sample));
  }
  assert.deepEqual(client.FORECAST_WEIGHTS, server.FORECAST_WEIGHTS);
  assert.equal(client.GOOD_WINDOW_SCORE, server.GOOD_WINDOW_SCORE);
  assert.equal(client.POSSIBLE_WINDOW_SCORE, server.POSSIBLE_WINDOW_SCORE);
});

test('the two copies stay textually identical apart from the header comment', async () => {
  const { readFile } = await import('node:fs/promises');
  const strip = (source: string) => source.slice(source.indexOf('export const FORECAST_LEVELS'));
  const a = await readFile('src/lib/invitationForecast.ts', 'utf8');
  const b = await readFile('supabase/functions/_shared/invitation-forecast.ts', 'utf8');
  assert.equal(strip(a), strip(b));
});

test('levels: quiet days are low, a consequence plus their sober time is good', () => {
  assert.equal(client.scoreReceptivity(input()).level, 'low');
  const good = client.scoreReceptivity(input({
    latestConsequenceAt: new Date(NOW - 2 * 3_600_000).toISOString(),
    soberTimes: ['evening'],
  }));
  assert.equal(good.level, 'good');
  assert.deepEqual(good.sources, ['consequence', 'sober_time']);
  assert.equal(client.scoreReceptivity(input({ latestConsequenceAt: new Date(NOW - 3_600_000).toISOString() })).level, 'possible');
});

test('safety and rough days always hold the window closed', () => {
  const everything = {
    latestConsequenceAt: new Date(NOW - 3_600_000).toISOString(),
    soberTimes: ['evening'],
    moveDaysLast7: 7,
    recoveryThisWeek: 5,
  };
  const serious = client.scoreReceptivity(input({ ...everything, todayCheck: 'calm', safetySerious: true }));
  assert.equal(serious.safetyHold, true);
  assert.equal(serious.level, 'low');
  assert.deepEqual(serious.reasons.map((reason) => reason.code), ['safetyHold']);
  const rough = client.scoreReceptivity(input({ ...everything, todayCheck: 'rough' }));
  assert.equal(rough.level, 'low');
  assert.equal(rough.reasons[0].code, 'roughToday');
});

test('consistency, trend and calm check contribute; good reasons lead with lifts', () => {
  const forecast = client.scoreReceptivity(input({
    moveDaysLast7: 5,
    recoveryThisWeek: 3,
    recoveryLastWeek: 1,
    todayCheck: 'calm',
    soberTimes: ['evening'],
  }));
  assert.equal(forecast.level, 'good');
  assert.deepEqual(forecast.sources, ['trend', 'sober_time', 'consistency', 'calm']);
  assert.ok(forecast.reasons.slice(0, 4).every((reason) => reason.effect === 'up'));
  assert.ok(forecast.score <= 100 && forecast.score >= 0);
});

test('a later sober time today still counts; a passed one gently lowers the score', () => {
  const morning = client.scoreReceptivity(input({ localHour: 9, soberTimes: ['evening'] }));
  assert.ok(morning.reasons.some((reason) => reason.code === 'soberTimeLater' && reason.params?.period === 'evening'));
  const night = client.scoreReceptivity(input({ localHour: 23, soberTimes: ['morning'] }));
  assert.ok(night.reasons.some((reason) => reason.code === 'soberTimeOther' && reason.params?.period === 'morning'));
  assert.equal(night.score, 15);
});

test('an empty current week never reads as an improving trend after a bad week (review regression)', () => {
  // Monday morning, nothing ticked yet; last week had 4 warning signs and 1 recovery sign.
  const empty = client.scoreReceptivity(input({ warningLastWeek: 4, recoveryLastWeek: 1, soberTimes: ['evening'], todayCheck: 'calm' }));
  assert.ok(!empty.sources.includes('trend'));
  assert.ok(!empty.reasons.some((reason) => reason.code === 'trendImproving' || reason.code === 'trendWorsening'));
  assert.equal(empty.score, 20 + 15 + 15);
  assert.notEqual(empty.level, 'good', 'no 5 PM window straight after a bad week');
  assert.deepEqual(empty, server.scoreReceptivity(input({ warningLastWeek: 4, recoveryLastWeek: 1, soberTimes: ['evening'], todayCheck: 'calm' })));
  // Once this week has entries the like-for-like comparison applies again.
  const logged = client.scoreReceptivity(input({ warningLastWeek: 4, recoveryLastWeek: 1, recoveryThisWeek: 2 }));
  assert.ok(logged.sources.includes('trend'));
});

test('after "not yet" or anger the level rests at low until the suggested window (audit regression)', () => {
  const lifts = { latestConsequenceAt: new Date(NOW - 3_600_000).toISOString(), soberTimes: ['evening'], todayCheck: 'calm' };
  for (const lastOutcome of ['not_yet', 'angry']) {
    const resting = client.scoreReceptivity(input({ ...lifts, lastOutcome, lastOutcomeDate: '2026-10-01', nextWindowDate: '2026-10-05' }));
    assert.equal(resting.level, 'low', lastOutcome);
    assert.deepEqual(resting.reasons[0], { code: 'restingUntil', effect: 'down', params: { days: 3 } });
  }
  assert.equal(client.scoreReceptivity(input({ ...lifts, lastOutcome: 'angry', nextWindowDate: '2026-10-02' })).level, 'good');
});

test('treatment or a recent yes pauses windows and the invite prompt (audit regression)', () => {
  const lifts = { latestConsequenceAt: new Date(NOW - 3_600_000).toISOString(), soberTimes: ['evening'], todayCheck: 'calm' };
  assert.equal(client.scoreReceptivity(input({ ...lifts, recoveryPhase: 'in_treatment' })).paused, 'in_treatment');
  assert.equal(client.scoreReceptivity(input({ ...lifts, lastOutcome: 'yes', lastOutcomeDate: '2026-10-01' })).paused, 'after_yes');
  assert.equal(client.scoreReceptivity(input({ ...lifts, lastOutcome: 'yes', lastOutcomeDate: '2026-08-01' })).paused, null);
  assert.equal(client.scoreReceptivity(input(lifts)).paused, null);
  assert.equal(client.daysBetween('2026-09-30', '2026-10-02'), 2);
});

test('the effective recovery phase matches the Today pathway card for every stage/status (audit round 2)', () => {
  const stages = [null, undefined, '', ...RECOVERY_PHASES, 'using', 'seeking_help', 'recovery', 'unsure', 'junk'];
  const statuses = [null, undefined, 'stable', 'in_treatment', 'unknown', 'using', 'escalating', 'crisis'];
  for (const stage of stages) {
    for (const status of statuses) {
      assert.equal(client.effectiveRecoveryPhase(stage, status), normalizeRecoveryPhase(stage, status), `${stage}/${status}`);
      assert.equal(server.effectiveRecoveryPhase(stage, status), normalizeRecoveryPhase(stage, status), `${stage}/${status}`);
    }
  }
});

test('the pause fires from the stage the app actually writes, for every after-yes phase (audit round 2)', () => {
  const lifts = { latestConsequenceAt: new Date(NOW - 3_600_000).toISOString(), soberTimes: ['evening'], todayCheck: 'calm' };
  const expected: Record<string, string | null> = {
    in_treatment: 'in_treatment',
    returning_home: 'returning_home',
    early_recovery_30: 'in_recovery',
    early_recovery_90: 'in_recovery',
    ongoing_recovery: 'in_recovery',
    active_use: null,
    considering_treatment: null,
    return_to_use: null,
    unsure: null,
  };
  for (const [stage, pause] of Object.entries(expected)) {
    // Status says "using" (the status picker never offers in_treatment): the stage wins.
    // The stage the pathway card writes wins over a "using" status.
    const phase = client.effectiveRecoveryPhase(stage, 'using');
    assert.equal(client.scoreReceptivity(input({ ...lifts, recoveryPhase: phase })).paused, pause, stage);
  }
  const onboarding = client.effectiveRecoveryPhase('recovery', 'stable');
  assert.equal(client.scoreReceptivity(input({ ...lifts, recoveryPhase: onboarding })).paused, 'in_recovery', 'onboarding "recovery" stage');
  const legacy = client.effectiveRecoveryPhase(null, 'in_treatment');
  assert.equal(client.scoreReceptivity(input({ ...lifts, recoveryPhase: legacy })).paused, 'in_treatment', 'legacy status with no stage');
});
