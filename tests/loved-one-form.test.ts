import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lovedOneChanges } from '../src/lib/lovedOneForm';
import type { LovedOne } from '../src/hooks/useLovedOne';

const saved: LovedOne = {
  id: 'lo', account_id: 'a', relationship: 'son', first_name: 'Jake', substances: ['opioids'],
  stage: 'in_treatment', status: 'escalating', created_at: '', updated_at: '',
};
const blank = { relationship: null, firstName: '', substances: [], stage: null, status: null };

test('a blank or untouched loved-one form never overwrites what she saved', () => {
  assert.deepEqual(lovedOneChanges(saved, blank), {});
  assert.deepEqual(lovedOneChanges(saved, {
    relationship: 'son', firstName: ' Jake ', substances: ['opioids'], stage: 'in_treatment', status: 'escalating',
  }), {});
});

test('only changed fields are saved, and a first-time form saves what she chose', () => {
  assert.deepEqual(lovedOneChanges(saved, { ...blank, status: 'crisis' }), { status: 'crisis' });
  assert.deepEqual(lovedOneChanges(null, { ...blank, relationship: 'daughter', firstName: 'Ana' }), { relationship: 'daughter', first_name: 'Ana' });
  assert.deepEqual(lovedOneChanges(null, blank), {});
});
