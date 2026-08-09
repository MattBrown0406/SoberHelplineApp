import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SAFETY_PLAN,
  isSafetyWalletReady,
  parseStoredIncidents,
  parseStoredRecord,
  safetyWalletCoreProgress,
  safetyStorageKey,
} from '../src/lib/safetyWallet';

test('migrates a legacy crisis plan without losing newly added safety fields', () => {
  const plan = parseStoredRecord(JSON.stringify({
    lovedOneName: 'Jordan',
    emergencyContacts: 'Alex · 555-0100',
  }), DEFAULT_SAFETY_PLAN);

  assert.equal(plan.lovedOneName, 'Jordan');
  assert.equal(plan.emergencyContacts, 'Alex · 555-0100');
  assert.equal(plan.naloxoneLocation, '');
  assert.equal(plan.childPickupPlan, '');
  assert.equal(plan.householdAddress, '');
});

test('ignores malformed stored fields and invalid JSON', () => {
  const plan = parseStoredRecord(JSON.stringify({
    lovedOneName: ['not', 'a', 'string'],
    weaponsAccess: 'Locked safe',
  }), DEFAULT_SAFETY_PLAN);

  assert.equal(plan.lovedOneName, '');
  assert.equal(plan.weaponsAccess, 'Locked safe');
  assert.deepEqual(parseStoredRecord('{bad json', DEFAULT_SAFETY_PLAN), DEFAULT_SAFETY_PLAN);
});

test('keeps only complete, typed incident records and caps local history', () => {
  const valid = {
    id: 'incident-1',
    createdAt: '2026-08-06T12:00:00.000Z',
    summary: 'A factual summary',
    substances: '',
    threats: '',
    childrenPresent: false,
    policeOrEms: false,
    boundaryCrossed: true,
  };
  const malformed = { ...valid, id: 42 };
  const incidents = parseStoredIncidents(JSON.stringify([
    malformed,
    ...Array.from({ length: 30 }, (_, index) => ({ ...valid, id: `incident-${index}` })),
  ]));

  assert.equal(incidents.length, 25);
  assert.equal(incidents[0].id, 'incident-0');
  assert.equal(incidents.at(-1)?.id, 'incident-24');
});

test('isolates saved safety data by account', () => {
  assert.equal(
    safetyStorageKey('account-a', 'plan'),
    'soberhelpline:crisis:account-a:plan',
  );
  assert.notEqual(
    safetyStorageKey('account-a', 'incidents'),
    safetyStorageKey('account-b', 'incidents'),
  );
});

test('requires the six practical core fields before the wallet is ready', () => {
  const partial = {
    ...DEFAULT_SAFETY_PLAN,
    emergencyContacts: 'Alex · 555-0100',
    preferredHospital: 'General Hospital',
    safeAdult: 'Sam · 555-0101',
    keysAndMedicationPlan: 'Locked cabinet',
    currentBoundaries: 'No cash',
  };
  assert.equal(isSafetyWalletReady(partial), false);
  assert.deepEqual(safetyWalletCoreProgress(partial), { completed: 5, total: 6 });

  const ready = { ...partial, decisionMakers: 'Alex, then Sam' };
  assert.equal(isSafetyWalletReady(ready), true);
  assert.deepEqual(safetyWalletCoreProgress(ready), { completed: 6, total: 6 });
});
