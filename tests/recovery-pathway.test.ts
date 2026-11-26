import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  normalizeRecoveryPhase,
  pathwayDaySlot,
  phaseNextStep,
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

test('without the Tracker, a path step never opens the members-only Tracker; members keep it', () => {
  for (const phase of RECOVERY_PHASES) {
    const member = phaseNextStep(phase, true);
    assert.equal(member.route, RECOVERY_PHASE_ROUTE[phase], phase);
    assert.equal(member.ctaKey, `pathway.phases.${phase}.cta`, phase);
    const free = phaseNextStep(phase, false);
    assert.notEqual(free.route, '/tracker', phase);
    // Phases that never led to the Tracker are unchanged for everyone.
    if (RECOVERY_PHASE_ROUTE[phase] !== '/tracker') assert.deepEqual(free, member, phase);
  }
  assert.deepEqual(phaseNextStep('unsure', false), { route: '/(tabs)/learn', ctaKey: 'pathway.freeCta.tools' });
  assert.deepEqual(phaseNextStep('early_recovery_30', false), { route: '/(tabs)/scripts?section=boundaries', ctaKey: 'pathway.freeCta.boundaries' });
  assert.deepEqual(phaseNextStep('early_recovery_90', false), { route: '/(tabs)/scripts?section=boundaries', ctaKey: 'pathway.freeCta.boundaries' });
  // Every label exists in both languages.
  for (const lang of ['en', 'es']) {
    const today = JSON.parse(readFileSync(`src/locales/${lang}/today.json`, 'utf8'));
    for (const phase of RECOVERY_PHASES) {
      for (const access of [true, false]) {
        const label = phaseNextStep(phase, access).ctaKey.split('.').reduce((node: any, key) => node?.[key], today);
        assert.equal(typeof label, 'string', `${lang} ${phase} ${access}`);
      }
    }
  }
  // Today's slot card asks for the access and uses the step for both route and label.
  const card = readFileSync('src/components/today/PathNextStepCard.tsx', 'utf8');
  assert.match(card, /const trackerAccess = useFeatureAccess\('tracker'\);/);
  assert.match(card, /phaseNextStep\(phase, trackerAccess\)/);
  assert.match(card, /router\.push\(step\.route as never\)/);
  assert.match(card, /\{t\(step\.ctaKey\)\}/);
});
