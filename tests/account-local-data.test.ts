import test from 'node:test';
import assert from 'node:assert/strict';
import { accountLocalKeys } from '../src/lib/accountLocalKeys';

test('account deletion purges only that account\'s device keys', () => {
  const account = '25603473-fa97-4d29-86e5-cc4902d88a0e';
  const auth = '14000000-0000-0000-0000-000000000001';
  const other = '99999999-0000-0000-0000-000000000009';
  const keys = [
    `soberhelpline:crisis:${account}:wallet`,
    `@sh:letter:${account}:Alex`,
    `legacy-daily-nudge-opt-in:v1:${account}`,
    `offline-account:${auth}`,
    `soberhelpline:crisis:${other}:wallet`,
    '@sh:language',
  ];
  assert.deepEqual(accountLocalKeys(keys, [account, auth]), keys.slice(0, 4));
  assert.deepEqual(accountLocalKeys(keys, ['', 'short']), []);
});
