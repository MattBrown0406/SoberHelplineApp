import {
  dayPeriod,
  type ForecastInput,
  laterPeriods,
  scoreReceptivity,
} from './invitation-forecast.ts';
import {
  evaluateWindowCandidate,
  forecastInputFromSnapshot,
  LOCK_SCREEN_FORBIDDEN,
  windowPushCopy,
} from './invitation-window.ts';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const NOW = Date.parse('2026-10-02T22:00:00Z');

function input(overrides: Partial<ForecastInput> = {}): ForecastInput {
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

Deno.test('a quiet day with nothing logged is a low window', () => {
  const forecast = scoreReceptivity(input());
  assertEquals(forecast.level, 'low', 'level');
  assertEquals(forecast.score, 20, 'base score');
  assertEquals(forecast.sources, [], 'no sources');
});

Deno.test('a fresh consequence plus their evening sober time is a good window', () => {
  const forecast = scoreReceptivity(input({
    latestConsequenceAt: new Date(NOW - 10 * 60 * 60 * 1000).toISOString(),
    soberTimes: ['evening'],
  }));
  assertEquals(forecast.level, 'good', 'level');
  assertEquals(forecast.sources, ['consequence', 'sober_time'], 'sources');
  const window = forecast.reasons.find((reason) => reason.code === 'consequenceWindow');
  assertEquals(window?.params?.hours, 62, 'hours left in the 72h window');
});

Deno.test('an expired consequence no longer counts', () => {
  const forecast = scoreReceptivity(input({
    latestConsequenceAt: new Date(NOW - 73 * 60 * 60 * 1000).toISOString(),
  }));
  assert(!forecast.sources.includes('consequence'), 'expired window ignored');
});

Deno.test('a rough day caps the level at low whatever else lines up', () => {
  const forecast = scoreReceptivity(input({
    latestConsequenceAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
    soberTimes: ['evening'],
    moveDaysLast7: 6,
    recoveryThisWeek: 4,
    todayCheck: 'rough',
  }));
  assertEquals(forecast.level, 'low', 'rough caps');
  assertEquals(forecast.reasons[0].code, 'roughToday', 'rough leads the reasons');
});

Deno.test('a serious safety concern always holds the forecast', () => {
  const forecast = scoreReceptivity(input({
    safetySerious: true,
    latestConsequenceAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
    todayCheck: 'calm',
  }));
  assertEquals(forecast, {
    level: 'low', score: 0, reasons: [{ code: 'safetyHold', effect: 'down' }], sources: [], safetyHold: true, paused: null,
  }, 'safety hold');
});

Deno.test('tracker trend, consistency and a calm check add up to a good window', () => {
  const forecast = scoreReceptivity(input({
    recoveryThisWeek: 3,
    recoveryLastWeek: 1,
    warningThisWeek: 1,
    warningLastWeek: 2,
    moveDaysLast7: 5,
    todayCheck: 'calm',
  }));
  assertEquals(forecast.score, 20 + 15 + 10 + 15, 'score');
  assertEquals(forecast.level, 'possible', 'without a sober-time match it stays possible');
  const withTime = scoreReceptivity(input({
    recoveryThisWeek: 3, recoveryLastWeek: 1, warningThisWeek: 1, warningLastWeek: 2,
    moveDaysLast7: 5, todayCheck: 'calm', soberTimes: ['evening'],
  }));
  assertEquals(withTime.level, 'good', 'with the evening match it is good');
});

Deno.test('worsening trend and a passed sober time pull the score down', () => {
  const forecast = scoreReceptivity(input({
    warningThisWeek: 4,
    warningLastWeek: 1,
    soberTimes: ['morning'],
    localHour: 20,
  }));
  assertEquals(forecast.score, 20 - 10 - 5, 'score');
  assert(forecast.reasons.some((reason) => reason.code === 'soberTimeOther' && reason.params?.period === 'morning'), 'other time');
});

Deno.test('an empty current week is no trend at all, however bad last week was', () => {
  const forecast = scoreReceptivity(input({ warningLastWeek: 4, recoveryLastWeek: 1 }));
  assertEquals(forecast.score, 20, 'no trend boost');
  assert(!forecast.sources.includes('trend'), 'no trend source');
  assert(!forecast.reasons.some((reason) => reason.code.startsWith('trend')), 'no trend reason');
});

Deno.test('weekend sober time matches on Saturday and Sunday only', () => {
  assert(scoreReceptivity(input({ soberTimes: ['weekend'], localWeekday: 6 })).sources.includes('sober_time'), 'saturday');
  assert(!scoreReceptivity(input({ soberTimes: ['weekend'], localWeekday: 3 })).sources.includes('sober_time'), 'wednesday');
});

Deno.test('day periods and the parts of the day still ahead', () => {
  assertEquals([4, 5, 11, 12, 16, 17, 21, 22].map(dayPeriod), ['night', 'morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening', 'night'], 'periods');
  assertEquals(laterPeriods(9), ['afternoon', 'evening'], 'morning');
  assertEquals(laterPeriods(17), [], 'evening');
  assertEquals(laterPeriods(2), ['morning', 'afternoon', 'evening'], 'small hours');
});

const CLOCK = { nowMs: NOW, localHour: 17, localWeekday: 5, localDate: '2026-10-02' };

Deno.test('snapshot parsing reads the RPC shape and treats junk as safety-first', () => {
  const parsed = forecastInputFromSnapshot({
    inputs: { latest_consequence_at: '2026-10-02T12:00:00Z', warning_this_week: 2, recovery_this_week: '3', move_days_7: 4 },
    plan: { signals: { sober_times: ['evening', 7] } },
    safety_first: false,
    loved_one_status: 'using',
    recovery_phase: 'considering_treatment',
    // The family-level gate drives pauses, not her own last log.
    last_attempt: { outcome: 'didnt_get_to_it', local_date: '2026-10-01' },
    outcome_gate: { outcome: 'not_yet', local_date: '2026-09-30', next_window_date: '2026-10-03' },
    today: { check: 'calm' },
    profile: { safety_concern: 'none' },
  }, CLOCK);
  assertEquals(parsed.soberTimes, ['evening'], 'strings only');
  assertEquals(parsed.recoveryThisWeek, 3, 'numeric strings');
  assertEquals(parsed.todayCheck, 'calm', 'check');
  assertEquals(parsed.safetySerious, false, 'own flag');
  assertEquals([parsed.lastOutcome, parsed.lastOutcomeDate, parsed.nextWindowDate, parsed.recoveryPhase],
    ['not_yet', '2026-09-30', '2026-10-03', 'considering_treatment'], 'outcome gate and family phase');
  const junk = forecastInputFromSnapshot('nope', CLOCK);
  assertEquals(junk.latestConsequenceAt, null, 'junk consequence');
  assertEquals(junk.safetySerious, true, 'an unknown safety flag holds the window');
});

Deno.test('after "not yet" or anger the forecast rests at low until the next window', () => {
  const lifts = { latestConsequenceAt: new Date(NOW - 3_600_000).toISOString(), soberTimes: ['evening'], todayCheck: 'calm' };
  for (const lastOutcome of ['not_yet', 'angry']) {
    const resting = scoreReceptivity(input({ ...lifts, lastOutcome, lastOutcomeDate: '2026-10-01', nextWindowDate: '2026-10-04' }));
    assertEquals(resting.level, 'low', `${lastOutcome} rests`);
    assertEquals(resting.reasons[0], { code: 'restingUntil', effect: 'down', params: { days: 2 } }, 'rest reason leads');
  }
  assertEquals(scoreReceptivity(input({ ...lifts, lastOutcome: 'not_yet', nextWindowDate: '2026-10-02' })).level, 'good', 'the window day itself is open');
  assertEquals(scoreReceptivity(input({ ...lifts, lastOutcome: 'didnt_get_to_it', nextWindowDate: '2026-10-03' })).level, 'good', 'no rest after a missed moment');
});

Deno.test('treatment or a recent yes pauses invitation windows entirely', () => {
  const lifts = { latestConsequenceAt: new Date(NOW - 3_600_000).toISOString(), soberTimes: ['evening'], todayCheck: 'calm' };
  const treatment = scoreReceptivity(input({ ...lifts, recoveryPhase: 'in_treatment' }));
  assertEquals([treatment.level, treatment.paused, treatment.reasons[0].code], ['low', 'in_treatment', 'inTreatment'], 'in treatment (stage)');
  assertEquals(scoreReceptivity(input({ ...lifts, recoveryPhase: 'returning_home' })).paused, 'returning_home', 'coming home');
  assertEquals(scoreReceptivity(input({ ...lifts, recoveryPhase: 'early_recovery_90' })).reasons[0].code, 'inRecovery', 'in recovery');
  assertEquals(scoreReceptivity(input({ ...lifts, recoveryPhase: 'return_to_use' })).paused, null, 'return to use reopens windows');
  const yes = scoreReceptivity(input({ ...lifts, lastOutcome: 'yes', lastOutcomeDate: '2026-09-20' }));
  assertEquals([yes.level, yes.paused], ['low', 'after_yes'], 'after yes');
  const later = scoreReceptivity(input({ ...lifts, lastOutcome: 'yes', lastOutcomeDate: '2026-08-20' }));
  assertEquals(later.paused, null, 'the after-yes pause lapses after 30 days');
});

Deno.test('the window push fires only for complete, safe, good forecasts', () => {
  const good = {
    profile: { completed: true, safety_concern: 'none' },
    plan: { signals: { sober_times: ['evening'] } },
    safety_first: false,
    inputs: { latest_consequence_at: new Date(NOW - 3600_000).toISOString(), move_days_7: 0 },
    today: { check: null },
  };
  const base = { account_id: 'a', locale: 'en', local_date: '2026-10-02', local_hour: 17, local_weekday: 5 };
  assertEquals(evaluateWindowCandidate({ ...base, snapshot: good }, NOW).push, true, 'good pushes');
  assertEquals(
    evaluateWindowCandidate({ ...base, snapshot: { ...good, safety_first: true } }, NOW).skipped,
    'safety',
    'her own safety-first flag blocks',
  );
  assertEquals(
    evaluateWindowCandidate({ ...base, snapshot: { ...good, plan: { signals: { sober_times: ['evening'], safety_serious: true } } } }, NOW).push,
    true,
    'nothing about another family member\'s safety answer is read',
  );
  assertEquals(
    evaluateWindowCandidate({ ...base, snapshot: { ...good, recovery_phase: 'in_treatment' } }, NOW).skipped,
    'paused',
    'no push while they are in treatment',
  );
  assertEquals(
    evaluateWindowCandidate({ ...base, snapshot: { ...good, outcome_gate: { outcome: 'angry', local_date: '2026-10-01', next_window_date: '2026-10-08' } } }, NOW).skipped,
    'not_good',
    'no push while the family rests after anger',
  );
  assertEquals(
    evaluateWindowCandidate({ ...base, snapshot: { ...good, outcome_gate: { outcome: 'yes', local_date: '2026-10-01' } } }, NOW).skipped,
    'paused',
    'no push after a yes anyone in the family logged',
  );
  for (const stage of ['in_treatment', 'returning_home', 'early_recovery_30', 'ongoing_recovery']) {
    assertEquals(
      evaluateWindowCandidate({ ...base, snapshot: { ...good, recovery_phase: stage } }, NOW).skipped,
      'paused',
      `no push while the pathway stage is ${stage}`,
    );
  }
  assertEquals(
    evaluateWindowCandidate({ ...base, snapshot: { ...good, profile: { completed: true, safety_concern: 'serious' } } }, NOW).skipped,
    'safety',
    'own safety flag blocks',
  );
  assertEquals(
    evaluateWindowCandidate({ ...base, snapshot: { ...good, profile: { completed: false } } }, NOW).skipped,
    'incomplete',
    'incomplete map blocks',
  );
  assertEquals(
    evaluateWindowCandidate({ ...base, snapshot: { ...good, inputs: {} } }, NOW).skipped,
    'not_good',
    'possible does not push',
  );
});

Deno.test('window push copy is localized and neutral enough for a lock screen', () => {
  assertEquals(windowPushCopy('es-MX').body, 'Tienes una nota para hoy.', 'spanish');
  assertEquals(windowPushCopy('en').body, 'You have a note for today.', 'english');
  assertEquals(windowPushCopy(null), windowPushCopy('en'), 'default');
  for (const locale of ['en', 'es']) {
    const copy = windowPushCopy(locale);
    // The brand name is the only allowed mention; nothing about the situation.
    const text = `${copy.title} ${copy.body}`.replace('Sober Helpline', '');
    assert(!LOCK_SCREEN_FORBIDDEN.test(text), `${locale} copy is neutral`);
  }
});

// The SQL producers' metadata is checked against these in tests/invitation-engine-sql.test.ts.
Deno.test('invitation push payloads carry only their routing kind', async () => {
  const { adminInvitationYesData, invitationWindowData } = await import('./push-data.ts');
  assertEquals(invitationWindowData(), { kind: 'invitation_window' }, 'window');
  assertEquals(adminInvitationYesData(), { kind: 'admin_invitation_yes' }, 'admin yes');
});
