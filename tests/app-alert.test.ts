import test from 'node:test';
import assert from 'node:assert/strict';
import { showWebAlert } from '../src/lib/webAlert';

test('web confirm runs the action only when the person confirms', () => {
  const calls: string[] = [];
  const buttons = [
    { text: 'Cancel', style: 'cancel' as const, onPress: () => { calls.push('cancel'); } },
    { text: 'Delete', style: 'destructive' as const, onPress: () => { calls.push('delete'); } },
  ];
  showWebAlert({ confirm: () => true }, 'Delete?', 'Gone for good', buttons);
  showWebAlert({ confirm: () => false }, 'Delete?', 'Gone for good', buttons);
  assert.deepEqual(calls, ['delete', 'cancel']);
});

test('web info alert shows the message and runs the single acknowledgement', () => {
  const shown: string[] = [];
  let acknowledged = false;
  showWebAlert({ alert: (m) => { shown.push(m); } }, 'Saved', 'All set', [{ text: 'OK', onPress: () => { acknowledged = true; } }]);
  assert.deepEqual(shown, ['Saved\n\nAll set']);
  assert.equal(acknowledged, true);
});

test('several choices are offered one at a time', () => {
  const asked: string[] = [];
  let chosen = '';
  showWebAlert(
    { confirm: (m) => { asked.push(m); return m.endsWith('Share with family?'); } },
    'Wavering', 'Let your family know?',
    [
      { text: 'Keep it private', onPress: () => { chosen = 'private'; } },
      { text: 'Share with family', onPress: () => { chosen = 'share'; } },
    ],
  );
  assert.equal(asked.length, 2);
  assert.equal(chosen, 'share');
});
