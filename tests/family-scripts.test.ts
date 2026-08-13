import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isWallAligned,
  matchFamilyScriptKind,
  sharedFamilyScript,
} from '../src/content/familyScripts';

test('maps money, housing, and 2am walls onto the shared rehearsal scripts', () => {
  assert.equal(matchFamilyScriptKind('I will no longer give cash or pay bills'), 'money');
  assert.equal(matchFamilyScriptKind('No drugs in this house — you cannot stay here'), 'housing');
  assert.equal(matchFamilyScriptKind("I will not take the 2am phone call unless it's 911"), 'crisis');
  assert.equal(matchFamilyScriptKind('I will end conversations that become cruel'), 'custom');
});

test('aligned walls require every member committed and nobody wavering', () => {
  assert.equal(isWallAligned(2, 2, false), true);
  assert.equal(isWallAligned(1, 2, false), false);
  assert.equal(isWallAligned(2, 2, true), false);
  assert.equal(isWallAligned(0, 0, false), false);
});

test('shared family script reuses the money / housing / crisis library', () => {
  const money = sharedFamilyScript('I will not give money');
  assert.equal(money.id, 'script-money');
  assert.equal(money.tag, 'FAMILY');
  const housing = sharedFamilyScript('You cannot stay here while using');
  assert.equal(housing.id, 'script-housing');
  const crisis = sharedFamilyScript('I will not negotiate on the 2 AM call');
  assert.equal(crisis.id, 'script-crisis');
  const custom = sharedFamilyScript('I will leave if I feel unsafe');
  assert.equal(custom.id, 'script-family-shared');
  assert.match(custom.trySaying, /I will leave if I feel unsafe/);
});
