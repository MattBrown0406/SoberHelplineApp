import assert from 'node:assert/strict';
import test from 'node:test';
import {
  caregiverResponseKey,
  isMoodScore,
  parseSupportNeed,
} from '../src/lib/caregiverCheckIn';
import { briefCaregiverAverage } from '../src/lib/situationBrief';
import type { CaregiverCheckInInput } from '../src/api/types';

function input(overrides: Partial<CaregiverCheckInInput> = {}): CaregiverCheckInInput {
  return {
    moodScore: 3,
    capacityScore: 3,
    pressureScore: 3,
    supportNeed: 'steady',
    ...overrides,
  };
}

test('prioritizes an immediate safety need over other check-in signals', () => {
  assert.equal(
    caregiverResponseKey(input({ capacityScore: 1, pressureScore: 5, supportNeed: 'safety' })),
    'safety',
  );
});

test('recognizes the combination of low capacity and high pressure', () => {
  assert.equal(caregiverResponseKey(input({ capacityScore: 2, pressureScore: 4 })), 'overloaded');
  assert.equal(caregiverResponseKey(input({ capacityScore: 3, pressureScore: 4 })), 'steady');
});

test('uses the caregiver-selected need when overload and safety do not apply', () => {
  assert.equal(caregiverResponseKey(input({ supportNeed: 'boundary' })), 'boundary');
  assert.equal(caregiverResponseKey(input({ supportNeed: 'connection' })), 'connection');
  assert.equal(caregiverResponseKey(input({ supportNeed: 'rest' })), 'rest');
});

test('validates cloud values before exposing them to the UI', () => {
  assert.equal(isMoodScore(1), true);
  assert.equal(isMoodScore(5), true);
  assert.equal(isMoodScore(0), false);
  assert.equal(isMoodScore('4'), false);
  assert.equal(parseSupportNeed('plan'), 'plan');
  assert.equal(parseSupportNeed('unknown'), null);
});

test('averages expanded caregiver signals while ignoring legacy check-ins', () => {
  const days = [
    { day: '2026-08-06', mood: 2, capacity: 2, pressure: 5, note: null },
    { day: '2026-08-05', mood: 3, capacity: 3, pressure: 4, note: null },
    { day: '2026-08-04', mood: 4, note: null },
  ];

  assert.equal(briefCaregiverAverage(days, 'capacity'), 2.5);
  assert.equal(briefCaregiverAverage(days, 'pressure'), 4.5);
  assert.equal(
    briefCaregiverAverage([{ day: '2026-08-04', mood: 4, note: null }], 'capacity'),
    null,
  );
});
