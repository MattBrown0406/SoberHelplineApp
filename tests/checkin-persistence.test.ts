import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeCheckInDates, persistDailyCheckIn } from '../src/lib/checkInPersistence';

const existingRow = { id: 'existing', mood: 4, note: null, created_at: '2026-07-28T01:00:00Z' };
const insertedRow = { id: 'inserted', mood: 3, note: null, created_at: '2026-07-28T02:00:00Z' };

test('returns the newly inserted check-in', async () => {
  let lookupCalled = false;
  const result = await persistDailyCheckIn(
    async () => ({ data: insertedRow, error: null }),
    async () => {
      lookupCalled = true;
      return { data: existingRow, error: null };
    },
  );

  assert.equal(result, insertedRow);
  assert.equal(lookupCalled, false);
});

test('resolves a duplicate-day race to the existing authoritative row', async () => {
  const result = await persistDailyCheckIn(
    async () => ({ data: null, error: { code: '23505', message: 'duplicate day' } }),
    async () => ({ data: existingRow, error: null }),
  );

  assert.equal(result, existingRow);
});

test('does not hide non-duplicate database failures', async () => {
  const denied = { code: '42501', message: 'permission denied' };
  await assert.rejects(
    persistDailyCheckIn(
      async () => ({ data: null, error: denied }),
      async () => ({ data: existingRow, error: null }),
    ),
    (error) => error === denied,
  );
});

test('surfaces an existing-row lookup failure after a duplicate', async () => {
  const lookupFailure = { code: 'PGRST000', message: 'network failure' };
  await assert.rejects(
    persistDailyCheckIn(
      async () => ({ data: null, error: { code: '23505', message: 'duplicate day' } }),
      async () => ({ data: null, error: lookupFailure }),
    ),
    (error) => error === lookupFailure,
  );
});

test('preserves the duplicate error if the conflicting row cannot be read', async () => {
  const duplicate = { code: '23505', message: 'duplicate day' };
  await assert.rejects(
    persistDailyCheckIn(
      async () => ({ data: null, error: duplicate }),
      async () => ({ data: null, error: null }),
    ),
    (error) => error === duplicate,
  );
});

test('merges a fresh-device local save without resetting cloud streak history', () => {
  assert.deepEqual(
    mergeCheckInDates(
      ['2026-07-27', '2026-07-26', '2026-07-25', '2026-07-24'],
      ['2026-07-28'],
      ['2026-07-28'],
    ),
    ['2026-07-28', '2026-07-27', '2026-07-26', '2026-07-25', '2026-07-24'],
  );
});
