import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  admissionsDialNumber,
  defaultTreatmentActionPlan,
  isTreatmentActionItemComplete,
  leaveTonightProgress,
  parseTreatmentActionPlan,
  TREATMENT_ACTION_DETAIL_LIMIT,
  TREATMENT_ACTION_ITEMS,
  treatmentActionProgress,
  treatmentYesState,
  updateTreatmentActionExecution,
  updateTreatmentActionItem,
} from '../src/lib/treatmentActionPlan';
import {
  treatmentActionExecutionStorageKey,
  treatmentActionItemStorageKey,
  treatmentActionMetaStorageKey,
} from '../src/lib/treatmentActionStorageKeys';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function confirmItem(plan: ReturnType<typeof defaultTreatmentActionPlan>, id: Parameters<typeof updateTreatmentActionItem>[1]) {
  return updateTreatmentActionItem(plan, id, { status: 'confirmed', details: `Confirmed ${id}` });
}

test('a new Treatment Action Plan starts red with nine advance items', () => {
  assert.deepEqual(treatmentActionProgress(defaultTreatmentActionPlan()), {
    completed: 0, total: 9, percentage: 0, ready: false,
  });
});

test('one-tap admissions dialing rejects extensions and incidental digits', () => {
  assert.equal(admissionsDialNumber('(503) 555-1212'), '5035551212');
  assert.equal(admissionsDialNumber('+1 503.555.1212'), '+15035551212');
  assert.equal(admissionsDialNumber('503-555-1212 ext 42'), null);
  assert.equal(admissionsDialNumber('503-555-1212 x42'), null);
  assert.equal(admissionsDialNumber('503-555-1212 #42'), null);
  assert.equal(admissionsDialNumber('room 42 — 503-555-1212'), null);
});

test('critical logistics do not turn green from a status tap without specific details', () => {
  const definition = TREATMENT_ACTION_ITEMS.find((item) => item.id === 'placement');
  assert.ok(definition);
  assert.equal(isTreatmentActionItemComplete(definition, {
    status: 'confirmed', details: '   ', updatedAt: null,
  }), false);
  assert.equal(isTreatmentActionItemComplete(definition, {
    status: 'confirmed', details: 'Admissions: Jordan; bed held until 10pm', updatedAt: null,
  }), true);
});

test('the bag cannot turn green without naming who packed and controls it', () => {
  const bag = TREATMENT_ACTION_ITEMS.find((item) => item.id === 'bag');
  assert.ok(bag);
  assert.equal(bag.detailsRequired, true);
  assert.equal(isTreatmentActionItemComplete(bag, {
    status: 'confirmed', details: '', updatedAt: null,
  }), false);
  assert.equal(isTreatmentActionItemComplete(bag, {
    status: 'confirmed', details: 'Maya packed it; Luis holds it by the garage door', updatedAt: null,
  }), true);
});

test('not applicable is limited to genuine work/dependent cases and requires a reason', () => {
  const work = TREATMENT_ACTION_ITEMS.find((item) => item.id === 'work');
  const transport = TREATMENT_ACTION_ITEMS.find((item) => item.id === 'transport');
  assert.ok(work && transport);
  assert.equal(isTreatmentActionItemComplete(work, {
    status: 'not_applicable', details: '', updatedAt: null,
  }), false);
  assert.equal(isTreatmentActionItemComplete(work, {
    status: 'not_applicable', details: 'Not currently employed', updatedAt: null,
  }), true);
  assert.equal(isTreatmentActionItemComplete(transport, {
    status: 'not_applicable', details: 'No ride needed', updatedAt: null,
  }), false);
});

test('the planned-conversation gate still requires every applicable item', () => {
  let plan = defaultTreatmentActionPlan();
  for (const definition of TREATMENT_ACTION_ITEMS) {
    plan = updateTreatmentActionItem(plan, definition.id, {
      status: definition.allowNotApplicable ? 'not_applicable' : 'confirmed',
      details: definition.allowNotApplicable ? 'Does not apply to this household' : `Confirmed ${definition.id}`,
    }, '2026-08-14T08:00:00.000Z');
  }
  assert.deepEqual(treatmentActionProgress(plan), {
    completed: 9, total: 9, percentage: 100, ready: true,
  });
});

test('leave-tonight readiness uses six essentials and structured handoff fields', () => {
  let plan = defaultTreatmentActionPlan();
  for (const id of ['placement', 'transport', 'bag', 'documents', 'money', 'backup'] as const) {
    plan = confirmItem(plan, id);
  }
  plan = updateTreatmentActionExecution(plan, {
    admissionsPhone: '+1 (503) 555-1212',
    driver: 'Luis',
    departureAt: '2026-08-15T05:00:00.000Z',
    nightWatch: 'Maya',
    phoneHolder: 'Ana',
    bagHolder: 'Luis',
  });
  assert.deepEqual(leaveTonightProgress(plan, new Date('2026-08-14T22:00:00.000Z')), {
    completed: 6, total: 6, percentage: 100, structuredReady: true, ready: true,
  });
  assert.equal(plan.items.work.status, 'not_started');
  assert.equal(plan.items.dependents.status, 'not_started');
  assert.equal(plan.items.coverage.status, 'not_started');
});

test('yes and recant clocks preserve logistics and stay separate from the consequence window', () => {
  let plan = updateTreatmentActionExecution(defaultTreatmentActionPlan(), {
    admissionsPhone: '503-555-1212',
    driver: 'Luis',
    departureAt: '2026-08-14T23:00:00.000Z',
    yesLoggedAt: '2026-08-14T20:00:00.000Z',
  });
  assert.deepEqual(treatmentYesState(plan, new Date('2026-08-14T21:15:00.000Z')), {
    mode: 'active', elapsedMinutes: 75, minutesToDeparture: 105,
  });
  plan = updateTreatmentActionExecution(plan, { recantedAt: '2026-08-14T21:20:00.000Z' });
  assert.equal(treatmentYesState(plan, new Date('2026-08-14T21:30:00.000Z')).mode, 'recanted');
  assert.equal(plan.execution.driver, 'Luis');
  assert.equal(admissionsDialNumber(plan.execution.admissionsPhone), '5035551212');
});

test('stored plans migrate safely and add empty execution details', () => {
  const parsed = parseTreatmentActionPlan(JSON.stringify({
    items: {
      placement: { status: 'confirmed', details: 'Bed confirmed', updatedAt: '2026-08-14T01:00:00Z' },
      coverage: { status: 'invented', details: 42 },
      unknown: { status: 'confirmed', details: 'ignore me' },
    },
    updatedAt: '2026-08-14T01:00:00Z',
  }));
  assert.equal(parsed.items.placement.status, 'confirmed');
  assert.equal(parsed.items.coverage.status, 'not_started');
  assert.equal(parsed.items.coverage.details, '');
  assert.equal(Object.keys(parsed.items).length, 9);
  assert.equal(parsed.execution.admissionsPhone, '');
  assert.equal(parsed.execution.yesLoggedAt, null);
});

test('protected storage keys and note limits are account scoped', () => {
  assert.notEqual(treatmentActionItemStorageKey('account-a', 'placement'), treatmentActionItemStorageKey('account-b', 'placement'));
  assert.notEqual(treatmentActionMetaStorageKey('account-a'), treatmentActionMetaStorageKey('account-b'));
  assert.notEqual(treatmentActionExecutionStorageKey('account-a'), treatmentActionExecutionStorageKey('account-b'));
  const oversized = 'x'.repeat(TREATMENT_ACTION_DETAIL_LIMIT + 50);
  const next = updateTreatmentActionItem(defaultTreatmentActionPlan(), 'placement', { details: oversized });
  assert.equal(next.items.placement.details.length, TREATMENT_ACTION_DETAIL_LIMIT);
});

test('safety exceptions remain visible while loading, after storage errors, and during gating', () => {
  const actionPlanScreen = readFileSync(resolve(TEST_DIR, '../app/treatment-action-plan.tsx'), 'utf8');
  const interventionScreen = readFileSync(resolve(TEST_DIR, '../app/plan-intervention.tsx'), 'utf8');
  assert.equal(actionPlanScreen.match(/<SafetyExceptions \/>/g)?.length, 3);
  assert.equal(interventionScreen.match(/<GateExceptions \/>/g)?.length, 3);
});

test('They Said Yes mode is on TAP with fixed departure, recant, and one-tap admissions call', () => {
  const actionPlanScreen = readFileSync(resolve(TEST_DIR, '../app/treatment-action-plan.tsx'), 'utf8');
  const yesMode = readFileSync(resolve(TEST_DIR, '../src/components/treatment/TheySaidYesMode.tsx'), 'utf8');
  assert.match(actionPlanScreen, /<TheySaidYesMode controller=\{controller\} \/>/);
  assert.match(yesMode, /yesLoggedAt: now\.toISOString\(\)/);
  assert.match(yesMode, /recantedAt: new Date\(\)\.toISOString\(\)/);
  assert.match(yesMode, /Linking\.openURL\(`tel:\$\{dialNumber\}`\)/);
  assert.match(yesMode, /departureAt: next\.toISOString\(\)/);
  assert.match(yesMode, /const departureLocked = state\.mode !== 'idle'/);
  assert.match(yesMode, /departureLocked \? \(/);
  assert.doesNotMatch(yesMode, /WILLINGNESS_WINDOW_HOURS|72-hour/);
});

test('clear blocks writes and invalidates every account-wide reload until protected deletion finishes', () => {
  const hook = readFileSync(resolve(TEST_DIR, '../src/hooks/useTreatmentActionPlan.ts'), 'utf8');
  assert.match(hook, /clearing: boolean/);
  assert.match(hook, /coordinator\.clearing = true/);
  assert.match(hook, /\+\+coordinator\.readVersion/);
  assert.match(hook, /currentReadVersion !== coordinator\.readVersion/);
  assert.match(hook, /if \(coordinator\.clearing\) return;\n\s+const currentReadVersion/);
  assert.ok((hook.match(/coordinatorFor\(accountId\)\.clearing/g) ?? []).length >= 2);
  assert.match(hook, /coordinator\.clearing = false;\n\s+publish\(accountId, \{ saveState: 'error' \}\)/);
});
