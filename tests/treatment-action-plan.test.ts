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
  parseProtectedTreatmentActionItem,
  parseProtectedTreatmentExecution,
  parseProtectedTreatmentMeta,
  parseProtectedTreatmentPlacement,
  parseTreatmentActionPlan,
  serializeProtectedTreatmentActionItem,
  serializeProtectedTreatmentExecution,
  serializeProtectedTreatmentMeta,
  serializeProtectedTreatmentPlacement,
  TREATMENT_ACTION_DETAIL_LIMIT,
  TREATMENT_ACTION_EXECUTION_LIMIT,
  TREATMENT_ACTION_SENTENCE_LIMIT,
  TREATMENT_EXECUTION_RECORD_BYTE_LIMIT,
  TREATMENT_PLACEMENT_FIELD_BYTE_LIMIT,
  TREATMENT_PLACEMENT_RECORD_BYTE_LIMIT,
  TREATMENT_ACTION_ITEMS,
  treatmentActionProgress,
  treatmentYesState,
  updateTreatmentActionExecution,
  updateTreatmentActionItem,
  updateTreatmentPlacementDetails,
} from '../src/lib/treatmentActionPlan';
import {
  treatmentActionExecutionStorageKey,
  treatmentActionItemStorageKey,
  treatmentActionMetaStorageKey,
  treatmentActionPlacementStorageKey,
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
  assert.deepEqual(leaveTonightProgress(plan, new Date('2026-08-15T05:00:00.000Z')), {
    completed: 6, total: 6, percentage: 100, structuredReady: true, ready: false,
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
  assert.equal(parsed.placementDetails.programName, '');
});

test('structured placement facts persist in TAP without duplicating its admissions phone', () => {
  const plan = updateTreatmentPlacementDetails(defaultTreatmentActionPlan(), {
    programName: 'Named Treatment Program',
    admissionsContactName: 'Jordan Lee',
    bedConfirmedFor: '2026-08-20',
    bedConfirmationWindow: 'Arrive 4–6 PM',
    bedConfirmedBy: 'Jordan Lee',
    bedReconfirmedAt: '2026-08-19T18:00:00.000Z',
  });
  const parsed = parseTreatmentActionPlan(JSON.stringify(plan));
  assert.deepEqual(parsed.placementDetails, plan.placementDetails);
  assert.equal('admissionsPhone' in parsed.placementDetails, false);
  const changedPlacement = updateTreatmentPlacementDetails(plan, { programName: 'Different Program' });
  assert.equal(changedPlacement.placementDetails.bedReconfirmedAt, null);
});

test('protected placement is byte bounded and malformed present records fail closed', () => {
  const hostile = '\\'.repeat(TREATMENT_PLACEMENT_FIELD_BYTE_LIMIT);
  const plan = updateTreatmentPlacementDetails(defaultTreatmentActionPlan(), {
    programName: hostile,
    admissionsContactName: hostile,
    bedConfirmedFor: hostile,
    bedConfirmationWindow: hostile,
    bedConfirmedBy: hostile,
    bedReconfirmedAt: '2026-08-19T18:00:00.000Z',
  });
  const raw = serializeProtectedTreatmentPlacement(plan.placementDetails);
  assert.ok(new TextEncoder().encode(raw).length <= TREATMENT_PLACEMENT_RECORD_BYTE_LIMIT);
  assert.deepEqual(parseProtectedTreatmentPlacement(raw), plan.placementDetails);
  const emojiPlan = updateTreatmentPlacementDetails(defaultTreatmentActionPlan(), {
    programName: '😀'.repeat(350), admissionsContactName: '😀'.repeat(350),
  });
  assert.ok(new TextEncoder().encode(emojiPlan.placementDetails.programName).length <= TREATMENT_PLACEMENT_FIELD_BYTE_LIMIT);
  assert.throws(() => parseProtectedTreatmentPlacement('{not-json'), /protected_tap_placement_malformed/);
  assert.throws(() => parseProtectedTreatmentPlacement(JSON.stringify({ programName: 'partial' })), /protected_tap_placement_malformed/);
  assert.equal(parseProtectedTreatmentPlacement(null), null);
});

test('protected execution is byte bounded and malformed present records fail closed', () => {
  const hostile = '\\'.repeat(TREATMENT_ACTION_EXECUTION_LIMIT);
  const plan = updateTreatmentActionExecution(defaultTreatmentActionPlan(), {
    admissionsPhone: hostile,
    driver: hostile,
    nightWatch: hostile,
    phoneHolder: hostile,
    bagHolder: hostile,
    sentence: '\\'.repeat(TREATMENT_ACTION_SENTENCE_LIMIT),
    departureAt: '2026-08-20T14:00:00.000Z',
    yesLoggedAt: '2026-08-20T13:00:00.000Z',
    recantedAt: null,
  });
  const raw = serializeProtectedTreatmentExecution(plan.execution);
  assert.ok(new TextEncoder().encode(raw).length <= TREATMENT_EXECUTION_RECORD_BYTE_LIMIT);
  assert.deepEqual(parseProtectedTreatmentExecution(raw), plan.execution);
  const emojiPlan = updateTreatmentActionExecution(defaultTreatmentActionPlan(), {
    admissionsPhone: '😀'.repeat(120), driver: '😀'.repeat(120), nightWatch: '😀'.repeat(120),
    phoneHolder: '😀'.repeat(120), bagHolder: '😀'.repeat(120), sentence: '😀'.repeat(240),
  });
  assert.ok(new TextEncoder().encode(JSON.stringify(emojiPlan.execution)).length <= TREATMENT_EXECUTION_RECORD_BYTE_LIMIT);
  const legacyExecution = { ...defaultTreatmentActionPlan().execution, driver: 'á'.repeat(120), sentence: 'é'.repeat(240) };
  const normalizedLegacy = parseProtectedTreatmentExecution(JSON.stringify(legacyExecution));
  assert.ok(normalizedLegacy);
  assert.equal(normalizedLegacy.driver.length, 120);
  assert.equal(normalizedLegacy.sentence.length, 240);
  const cjkLegacy = {
    ...defaultTreatmentActionPlan().execution,
    admissionsPhone: '漢'.repeat(120), driver: '漢'.repeat(120), nightWatch: '漢'.repeat(120),
    phoneHolder: '漢'.repeat(120), bagHolder: '漢'.repeat(120), sentence: '漢'.repeat(240),
  };
  const loadedCjkLegacy = parseProtectedTreatmentExecution(JSON.stringify(cjkLegacy));
  assert.deepEqual(loadedCjkLegacy, cjkLegacy);
  const unchangedOversizedLegacy = updateTreatmentActionExecution(
    { ...defaultTreatmentActionPlan(), execution: cjkLegacy },
    { driver: 'replacement' },
  );
  assert.deepEqual(unchangedOversizedLegacy.execution, cjkLegacy);
  assert.throws(() => parseProtectedTreatmentExecution('{not-json'), /protected_tap_execution_malformed/);
  assert.throws(() => parseProtectedTreatmentExecution(JSON.stringify({ admissionsPhone: 'partial' })), /protected_tap_execution_malformed/);
  assert.equal(parseProtectedTreatmentExecution(null), null);
});

test('present protected TAP item and meta records fail closed when partial or malformed', () => {
  const item = updateTreatmentActionItem(defaultTreatmentActionPlan(), 'placement', {
    status: 'working', details: '😀'.repeat(TREATMENT_ACTION_DETAIL_LIMIT),
  }).items.placement;
  const itemRaw = serializeProtectedTreatmentActionItem(item);
  assert.ok(new TextEncoder().encode(itemRaw).length <= 1800);
  assert.deepEqual(parseProtectedTreatmentActionItem(itemRaw), item);
  const controls = updateTreatmentActionItem(defaultTreatmentActionPlan(), 'placement', { details: '\u0000'.repeat(350) });
  assert.equal(controls.items.placement.details, '');
  const legacyMultiline = { ...item, details: 'Línea uno\nLínea dos\tcontinuación' };
  assert.equal(parseProtectedTreatmentActionItem(JSON.stringify(legacyMultiline))?.details, 'Línea uno Línea dos continuación');
  assert.throws(() => parseProtectedTreatmentActionItem('{not-json'), /protected_tap_item_malformed/);
  assert.throws(() => parseProtectedTreatmentActionItem(JSON.stringify({ status: 'working' })), /protected_tap_item_malformed/);
  const metaRaw = serializeProtectedTreatmentMeta('2026-08-19T18:00:00.000Z');
  assert.equal(parseProtectedTreatmentMeta(metaRaw), '2026-08-19T18:00:00.000Z');
  assert.throws(() => serializeProtectedTreatmentMeta('x'.repeat(2_000_000)), /protected_tap_meta_malformed/);
  assert.throws(() => parseProtectedTreatmentMeta(JSON.stringify({ updatedAt: 'x'.repeat(200) })), /protected_tap_meta_oversized/);
  assert.throws(() => parseProtectedTreatmentMeta('{}'), /protected_tap_meta_malformed/);
  assert.throws(() => parseProtectedTreatmentMeta('{not-json'), /protected_tap_meta_malformed/);
  assert.equal(parseProtectedTreatmentActionItem(null), null);
  assert.equal(parseProtectedTreatmentMeta(null), null);
});

test('protected storage keys and note limits are account scoped', () => {
  assert.notEqual(treatmentActionItemStorageKey('account-a', 'placement'), treatmentActionItemStorageKey('account-b', 'placement'));
  assert.notEqual(treatmentActionMetaStorageKey('account-a'), treatmentActionMetaStorageKey('account-b'));
  assert.notEqual(treatmentActionExecutionStorageKey('account-a'), treatmentActionExecutionStorageKey('account-b'));
  assert.notEqual(treatmentActionPlacementStorageKey('account-a'), treatmentActionPlacementStorageKey('account-b'));
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
  assert.match(hook, /if \(coordinator\.clearing\) return;[\s\S]*?const currentReadVersion = \+\+coordinator\.readVersion/);
  assert.ok((hook.match(/coordinatorFor\(accountId\)\.clearing/g) ?? []).length >= 2);
  assert.match(hook, /coordinator\.hadFailure = true;\n\s+coordinator\.clearing = false;\n\s+publish\(accountId, \{ loadState: 'error', saveState: 'error' \}\)/);
});

test('reload waits behind TAP writes and cannot publish stale protected state', () => {
  const hook = readFileSync(resolve(TEST_DIR, '../src/hooks/useTreatmentActionPlan.ts'), 'utf8');
  assert.match(hook, /const mutationVersion = coordinator\.version/);
  assert.match(hook, /await coordinator\.queue\.catch\(\(\) => undefined\)/);
  assert.ok((hook.match(/if \(coordinator\.hadFailure\)/g) ?? []).length >= 3);
  assert.match(hook, /await coordinator\.queue\.catch\(\(\) => undefined\);[\s\S]*?publish\(accountId, \{ loadState: 'error', saveState: 'error' \}\)/);
  assert.ok((hook.match(/mutationVersion !== coordinator\.version/g) ?? []).length >= 3);
  assert.match(hook, /if \(coordinator\.hadFailure\) \{\n\s+publish\(accountId, \{ saveState: 'error' \}\)/);
  assert.match(hook, /Promise\.allSettled/);
  assert.match(hook, /\+\+coordinator\.readVersion;\n\s+const version = \+\+coordinator\.version/);
});
