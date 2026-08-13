import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeRecoveryPhase,
  pathwayDaySlot,
  RECOVERY_PHASE_ROUTE,
  RECOVERY_PHASES,
} from '../src/lib/recoveryPathway';

test('keeps every expanded phase stable', () => {
  for (const phase of RECOVERY_PHASES) {
    assert.equal(normalizeRecoveryPhase(phase, 'crisis'), phase);
    assert.ok(RECOVERY_PHASE_ROUTE[phase]);
  }
});

test('maps original onboarding stages to the family pathway', () => {
  assert.equal(normalizeRecoveryPhase('using', 'unknown'), 'active_use');
  assert.equal(normalizeRecoveryPhase('seeking_help', 'unknown'), 'considering_treatment');
  assert.equal(normalizeRecoveryPhase('in_treatment', 'unknown'), 'in_treatment');
  assert.equal(normalizeRecoveryPhase('recovery', 'stable'), 'early_recovery_30');
  assert.equal(normalizeRecoveryPhase('recovery', 'using'), 'return_to_use');
  assert.equal(normalizeRecoveryPhase('unsure', 'stable'), 'unsure');
});

test('uses situation status only when no explicit phase exists', () => {
  assert.equal(normalizeRecoveryPhase(null, 'in_treatment'), 'in_treatment');
  assert.equal(normalizeRecoveryPhase(null, 'escalating'), 'active_use');
  assert.equal(normalizeRecoveryPhase(null, 'stable'), 'unsure');
});

test('daily rotation is stable within a local date and guards invalid counts', () => {
  const morning = new Date(2026, 7, 6, 8, 0);
  const evening = new Date(2026, 7, 6, 22, 0);
  const tomorrow = new Date(2026, 7, 7, 8, 0);

  assert.equal(pathwayDaySlot(morning), pathwayDaySlot(evening));
  assert.notEqual(pathwayDaySlot(morning), pathwayDaySlot(tomorrow));
  assert.equal(pathwayDaySlot(morning, 0), 0);
});
