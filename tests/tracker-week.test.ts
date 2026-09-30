import test from 'node:test';
import assert from 'node:assert/strict';
import { getWeekStart } from '../src/lib/trackerWeek';

test('tracker week follows the member\'s local Sunday evening, not UTC Monday', () => {
  // Sunday 2026-09-27 18:00 in Los Angeles is already Monday 01:00 UTC.
  const sundayEveningPacific = new Date('2026-09-28T01:00:00Z');
  assert.equal(getWeekStart(sundayEveningPacific, 'America/Los_Angeles'), '2026-09-21');
  assert.equal(getWeekStart(sundayEveningPacific, 'UTC'), '2026-09-28');
});

test('Monday morning starts a new week', () => {
  assert.equal(getWeekStart(new Date('2026-09-28T16:00:00Z'), 'America/Los_Angeles'), '2026-09-28');
});
