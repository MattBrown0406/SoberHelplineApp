import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultTreatmentActionPlan,
  isTreatmentActionItemComplete,
  parseTreatmentActionPlan,
  TREATMENT_ACTION_DETAIL_LIMIT,
  TREATMENT_ACTION_ITEMS,
  treatmentActionProgress,
  updateTreatmentActionItem,
} from '../src/lib/treatmentActionPlan';
import {
  treatmentActionItemStorageKey,
  treatmentActionMetaStorageKey,
} from '../src/lib/treatmentActionStorageKeys';

test('a new Treatment Action Plan starts red with nine advance items', () => {
  const plan = defaultTreatmentActionPlan();
  assert.deepEqual(treatmentActionProgress(plan), {
    completed: 0,
    total: 9,
    percentage: 0,
    ready: false,
  });
});

test('critical logistics do not turn green from a status tap without specific details', () => {
  const definition = TREATMENT_ACTION_ITEMS.find((item) => item.id === 'placement');
  assert.ok(definition);
  assert.equal(isTreatmentActionItemComplete(definition, {
    status: 'confirmed',
    details: '   ',
    updatedAt: null,
  }), false);
  assert.equal(isTreatmentActionItemComplete(definition, {
    status: 'confirmed',
    details: 'Admissions: Jordan, called 8/14 at 4pm; bed held until 10pm',
    updatedAt: null,
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

test('the conversation gate turns green only when every applicable item is complete', () => {
  let plan = defaultTreatmentActionPlan();
  for (const definition of TREATMENT_ACTION_ITEMS) {
    plan = updateTreatmentActionItem(plan, definition.id, {
      status: definition.allowNotApplicable ? 'not_applicable' : 'confirmed',
      details: definition.allowNotApplicable ? 'Does not apply to this household' : `Confirmed ${definition.id}`,
    }, '2026-08-14T08:00:00.000Z');
  }
  assert.deepEqual(treatmentActionProgress(plan), {
    completed: 9,
    total: 9,
    percentage: 100,
    ready: true,
  });
});

test('stored plans migrate safely', () => {
  const parsed = parseTreatmentActionPlan(JSON.stringify({
    items: {
      placement: { status: 'confirmed', details: 'Bed confirmed', updatedAt: 'now' },
      coverage: { status: 'invented', details: 42 },
      unknown: { status: 'confirmed', details: 'ignore me' },
    },
    updatedAt: 'now',
  }));
  assert.equal(parsed.items.placement.status, 'confirmed');
  assert.equal(parsed.items.coverage.status, 'not_started');
  assert.equal(parsed.items.coverage.details, '');
  assert.equal(Object.keys(parsed.items).length, 9);
});

test('protected storage keys and note limits are account scoped', () => {
  assert.notEqual(
    treatmentActionItemStorageKey('account-a', 'placement'),
    treatmentActionItemStorageKey('account-b', 'placement'),
  );
  assert.notEqual(
    treatmentActionMetaStorageKey('account-a'),
    treatmentActionMetaStorageKey('account-b'),
  );
  const oversized = 'x'.repeat(TREATMENT_ACTION_DETAIL_LIMIT + 50);
  const next = updateTreatmentActionItem(defaultTreatmentActionPlan(), 'placement', { details: oversized });
  assert.equal(next.items.placement.details.length, TREATMENT_ACTION_DETAIL_LIMIT);
});
