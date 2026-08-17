import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultFamilyOutcomeDraft,
  FAMILY_OUTCOME_EVENTS,
  FAMILY_OUTCOME_LEVELS,
  FAMILY_OUTCOME_PATHWAYS,
  localDateString,
  parseFamilyOutcome,
  validateFamilyOutcomeDraft,
} from '../src/lib/familyOutcomes';

test('exports the complete evidence allowlists', () => {
  assert.deepEqual(FAMILY_OUTCOME_EVENTS, [
    'entered_care', 'changed_level_of_care', 'completed_care', 'left_care_early',
    'returned_home', 'returned_to_use', 'reengaged_in_care', 'other',
  ]);
  assert.deepEqual(FAMILY_OUTCOME_LEVELS, [
    'withdrawal_management', 'residential', 'partial_hospitalization',
    'intensive_outpatient', 'outpatient', 'recovery_residence', 'hospital',
    'other', 'unknown',
  ]);
  assert.deepEqual(FAMILY_OUTCOME_PATHWAYS, [
    'self_initiated', 'family_boundary', 'planned_intervention',
    'professional_intervention', 'crisis_or_emergency', 'clinician_referral',
    'court_or_legal', 'provider_transfer', 'peer_or_recovery_support',
    'other', 'unknown',
  ]);
});

test('creates safe defaults and preserves contextual prefill', () => {
  const draft = defaultFamilyOutcomeDraft(
    'entered_care',
    'planned_intervention',
    new Date(2026, 7, 17, 23, 45),
  );
  assert.equal(draft.occurredOn, '2026-08-17');
  assert.equal(draft.event, 'entered_care');
  assert.equal(draft.pathway, 'planned_intervention');
  assert.equal(draft.levelOfCare, 'unknown');
  assert.equal(draft.pathwayNote, '');
});

test('validates calendar dates, future dates, and the note bound', () => {
  const draft = defaultFamilyOutcomeDraft('entered_care', 'self_initiated');
  draft.occurredOn = '2026-02-30';
  assert.equal(validateFamilyOutcomeDraft(draft, '2026-08-17'), 'date');
  draft.occurredOn = '2026-08-18';
  assert.equal(validateFamilyOutcomeDraft(draft, '2026-08-17'), 'date');
  draft.occurredOn = '2026-08-17';
  draft.pathwayNote = 'x'.repeat(501);
  assert.equal(validateFamilyOutcomeDraft(draft, '2026-08-17'), 'note');
  draft.pathwayNote = 'x'.repeat(500);
  assert.equal(validateFamilyOutcomeDraft(draft, '2026-08-17'), null);
});

test('formats local dates without a UTC day shift', () => {
  assert.equal(localDateString(new Date(2026, 0, 2, 0, 5)), '2026-01-02');
});

test('parses only allowlisted database rows and no identity or diagnosis fields', () => {
  const parsed = parseFamilyOutcome({
    id: 'id',
    client_event_id: 'client-id',
    event: 'entered_care',
    occurred_on: '2026-08-17',
    level_of_care: 'residential',
    pathway: 'family_boundary',
    pathway_note: 'Admission followed the held boundary.',
    created_at: '2026-08-17T12:00:00Z',
    updated_at: '2026-08-17T12:00:00Z',
    loved_one_name: 'must not be mapped',
    diagnosis: 'must not be mapped',
  });
  assert.ok(parsed);
  assert.deepEqual(Object.keys(parsed).sort(), [
    'clientEventId', 'createdAt', 'event', 'id', 'levelOfCare',
    'occurredOn', 'pathway', 'pathwayNote', 'updatedAt',
  ]);
  assert.equal(parseFamilyOutcome({ ...parsed, id: 'id' } as never), null);
});
