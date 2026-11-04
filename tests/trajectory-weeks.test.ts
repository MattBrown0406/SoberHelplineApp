import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getWeekStart, trajectoryWeeks } from '../src/lib/trackerWeek';

test('the trajectory uses the same local Mondays the tracker writes, even on Sunday evening', () => {
  // Sunday 2026-11-08 6 PM Pacific is already Monday in UTC.
  const sundayEvening = new Date('2026-11-09T02:00:00Z');
  const weeks = trajectoryWeeks(sundayEvening, 6, 'America/Los_Angeles');
  assert.deepEqual(weeks, ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']);
  assert.equal(weeks[weeks.length - 1], getWeekStart(sundayEvening, 'America/Los_Angeles'));
  // Monday morning moves it on.
  assert.equal(trajectoryWeeks(new Date('2026-11-09T17:00:00Z'), 6, 'America/Los_Angeles')[5], '2026-11-09');
});
