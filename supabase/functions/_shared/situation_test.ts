import { bandForSignals, effectiveLovedStatus, lovedOneWeight, recoveryPhase } from './situation.ts';
// Local helper: CI runs these tests with a frozen deno.lock, so no new remote imports.
function assertEquals(actual: unknown, expected: unknown, message = 'values differ') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const NOW = Date.parse('2026-10-04T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString();

// Same table as supabase/tests/situation_status_decay_test.sql.
Deno.test('loved-one weight mirrors _loved_one_status_weight', () => {
  const cases: [string, Parameters<typeof lovedOneWeight>[0], number, number][] = [
    ['bare status string keeps plain weights', 'escalating', 0, 25],
    ['no loved one', null, 0, 5],
    ['no stage, stable', { status: 'stable', status_changed_at: daysAgo(1) }, 0, 0],
    ['no stage, fresh escalation', { status: 'escalating', status_changed_at: daysAgo(2) }, 0, 25],
    ['escalation 20 days old fades', { status: 'escalating', status_changed_at: daysAgo(20) }, 0, 15],
    ['old escalation kept by a new spike', { status: 'escalating', status_changed_at: daysAgo(20) }, 3, 25],
    ['crisis does not fade by time', { status: 'crisis', status_changed_at: daysAgo(60) }, 0, 35],
    ['treatment saved after escalation',
      { status: 'escalating', stage: 'in_treatment', stage_changed_at: daysAgo(1), status_changed_at: daysAgo(5) }, 0, 0],
    ['escalation after treatment stage counts',
      { status: 'escalating', stage: 'in_treatment', stage_changed_at: daysAgo(5), status_changed_at: daysAgo(1) }, 0, 25],
    ['active use stage, stable status', { status: 'stable', stage: 'active_use', stage_changed_at: daysAgo(1) }, 0, 15],
    ['considering treatment', { status: 'using', stage: 'considering_treatment', stage_changed_at: daysAgo(1) }, 0, 10],
    ['returning home', { status: 'stable', stage: 'returning_home', stage_changed_at: daysAgo(1) }, 0, 5],
    ['unsure stage keeps status weight', { status: 'using', stage: 'unsure', stage_changed_at: daysAgo(1) }, 0, 15],
  ];
  for (const [label, loved, warnings, weight] of cases) {
    assertEquals(lovedOneWeight(loved, warnings, NOW), weight, label);
  }
});

Deno.test('effective status and phase', () => {
  assertEquals(effectiveLovedStatus({ status: 'escalating', status_changed_at: daysAgo(20) }, 0, NOW), 'using');
  assertEquals(effectiveLovedStatus({ status: 'crisis', stage: 'early_recovery_90', stage_changed_at: daysAgo(1),
    status_changed_at: daysAgo(5) }, 0, NOW), 'stable');
  assertEquals(recoveryPhase('recovery', 'escalating'), 'return_to_use');
  assertEquals(recoveryPhase(null, 'in_treatment'), 'in_treatment');
});

Deno.test('bands come down once an escalation no longer applies', () => {
  assertEquals(bandForSignals(1, 0, { status: 'escalating', status_changed_at: daysAgo(2) }, 0, NOW), 'elevated');
  assertEquals(bandForSignals(1, 0, { status: 'escalating', status_changed_at: daysAgo(20) }, 0, NOW), 'watch');
  assertEquals(bandForSignals(1, 0, { status: 'escalating', stage: 'in_treatment', stage_changed_at: daysAgo(1),
    status_changed_at: daysAgo(3) }, 0, NOW), 'watch');
  assertEquals(bandForSignals(3, 0, { status: 'crisis', stage: 'active_use', stage_changed_at: daysAgo(1) }, 0, NOW), 'crisis');
});
