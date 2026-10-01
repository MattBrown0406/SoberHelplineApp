import {
  CALENDAR_SYNC_MAX_ATTEMPTS,
  calendarDeferredUpdate,
  calendarEventIdFor,
  calendarFailureUpdate,
  calendarOperationFor,
  calendarRetryDelayMinutes,
  deterministicEventId,
  statusAfterDelete,
} from './calendar-sync-retry.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-01T12:00:00.000Z');

Deno.test('a live session is deferred instead of failing as a status conflict', () => {
  assert(calendarOperationFor('live', 'auto') === 'defer', 'live auto dispatch must defer');
  assert(calendarOperationFor('LIVE ', 'confirmed') === 'defer', 'live explicit action must defer');
});

Deno.test('operations for the remaining statuses', () => {
  assert(calendarOperationFor('scheduled', 'auto') === 'upsert', 'scheduled upserts');
  assert(calendarOperationFor('cancelled', 'auto') === 'delete', 'cancelled deletes');
  assert(calendarOperationFor('no_show', 'auto') === 'delete', 'no-show deletes');
  assert(calendarOperationFor('completed', 'auto') === 'noop', 'completed keeps the past event');
  // A confirmed time withdrawn before its id was stored still has an event.
  assert(calendarOperationFor('requested', 'auto') === 'delete', 'requested deletes by deterministic id');
  assert(calendarOperationFor('scheduled', 'cancel') === 'conflict', 'cancel on a scheduled row conflicts');
  assert(calendarOperationFor('cancelled', 'confirmed') === 'conflict', 'confirm on a cancelled row conflicts');
});

Deno.test('a missing calendar_event_id deletes the deterministic creation id', () => {
  const expected = `vsession${SESSION_ID.replaceAll('-', '')}`;
  assert(deterministicEventId(SESSION_ID) === expected, 'deterministic id format is stable');
  assert(calendarEventIdFor({ id: SESSION_ID, calendar_event_id: null }) === expected, 'NULL id falls back to deterministic id');
  assert(calendarEventIdFor({ id: SESSION_ID, calendar_event_id: 'stored-id' }) === 'stored-id', 'stored id wins');
});

Deno.test('delete of a requested session leaves it not_synced, terminal sessions cancelled', () => {
  assert(statusAfterDelete('requested') === 'not_synced', 'requested returns to not_synced');
  assert(statusAfterDelete('cancelled') === 'cancelled', 'cancelled stays cancelled');
  assert(statusAfterDelete('no_show') === 'cancelled', 'no-show is cancelled in the calendar');
});

Deno.test('backoff is exponential and capped', () => {
  const delays = [1, 2, 3, 4, 5, 6, 10].map(calendarRetryDelayMinutes);
  assert(JSON.stringify(delays) === JSON.stringify([5, 10, 20, 40, 80, 120, 120]), `unexpected delays ${delays}`);
  assert(calendarRetryDelayMinutes(0) === 5, 'zero attempts still waits the base delay');
  assert(calendarRetryDelayMinutes(Number.NaN) === 5, 'non-numeric attempts use the base delay');
});

Deno.test('failure schedules the next attempt until attempts are exhausted', () => {
  const first = calendarFailureUpdate(1, 'google_calendar_failed: x', NOW);
  assert(first.calendar_sync_status === 'failed', 'failure status');
  assert(first.calendar_sync_error === 'google_calendar_failed: x', 'error kept for the admin card');
  assert(first.calendar_next_attempt_at === '2026-10-01T12:05:00.000Z', `first retry in 5 minutes, got ${first.calendar_next_attempt_at}`);
  const third = calendarFailureUpdate(3, 'e', NOW);
  assert(third.calendar_next_attempt_at === '2026-10-01T12:20:00.000Z', 'third retry in 20 minutes');
  const last = calendarFailureUpdate(CALENDAR_SYNC_MAX_ATTEMPTS, 'e', NOW);
  assert(last.calendar_next_attempt_at === null, 'no automatic retry after the attempt limit');
});

Deno.test('a deferred live dispatch is not counted as an attempt', () => {
  const update = calendarDeferredUpdate(3, NOW);
  assert(update.calendar_sync_status === 'pending', 'deferred rows stay pending');
  assert(update.calendar_sync_attempts === 2, 'the dispatch increment is undone');
  assert(update.calendar_sync_error === null, 'no error is recorded');
  assert(update.calendar_next_attempt_at === '2026-10-01T12:15:00.000Z', 'checked again in 15 minutes');
  assert(calendarDeferredUpdate(0, NOW).calendar_sync_attempts === 0, 'attempts never go negative');
});
