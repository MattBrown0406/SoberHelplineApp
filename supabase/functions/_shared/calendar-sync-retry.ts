// Pure retry/operation policy for sync-video-session-calendar. The dispatcher
// (public.dispatch_pending_video_calendar_sync) counts attempts and re-leases
// 'failed' rows once calendar_next_attempt_at has passed.

/** The dispatcher stops retrying a failed sync after this many attempts. */
export const CALENDAR_SYNC_MAX_ATTEMPTS = 6;
const RETRY_BASE_MINUTES = 5;
const RETRY_CAP_MINUTES = 120;
/** A session that is live is re-checked later instead of being marked failed. */
export const CALENDAR_LIVE_RETRY_MINUTES = 15;

export type CalendarOperation = 'upsert' | 'delete' | 'noop' | 'defer' | 'conflict';

const UPSERT_STATES = new Set(['scheduled']);
const TERMINAL_STATES = new Set(['cancelled', 'no_show']);
export const UPSERT_ACTIONS = new Set(['upsert', 'create', 'patch', 'confirmed', 'rescheduled']);
export const DELETE_ACTIONS = new Set(['delete', 'cancel', 'cancelled', 'completed', 'no_show']);
export const ALLOWED_ACTIONS = new Set(['auto', ...UPSERT_ACTIONS, ...DELETE_ACTIONS]);

/** The Google event id a session's event is created under. */
export function deterministicEventId(sessionId: string): string {
  return `vsession${sessionId.replaceAll('-', '').toLowerCase()}`;
}

/**
 * The event to update or delete. An event created by an earlier sync whose id
 * was never stored (failed save, superseded lease, cancel while in flight)
 * still carries the deterministic id, so a NULL id is never a reason to skip.
 */
export function calendarEventIdFor(session: { id: string; calendar_event_id: string | null }): string {
  return session.calendar_event_id || deterministicEventId(session.id);
}

/**
 * What a dispatched sync should do for the session's current status.
 * - `defer`: the session is live; check again later rather than failing.
 * - `delete` for a requested session: a sync may have created the event
 *   before the confirmed time was withdrawn (counteroffer/reschedule); a
 *   missing event is reported by Google as already absent.
 */
export function calendarOperationFor(status: string, action: string): CalendarOperation {
  const normalizedStatus = status.trim().toLowerCase();
  if (normalizedStatus === 'live') return 'defer';
  if (action === 'auto') {
    if (UPSERT_STATES.has(normalizedStatus)) return 'upsert';
    if (normalizedStatus === 'requested') return 'delete';
    if (normalizedStatus === 'completed') return 'noop';
    if (TERMINAL_STATES.has(normalizedStatus)) return 'delete';
  } else if (UPSERT_ACTIONS.has(action) && UPSERT_STATES.has(normalizedStatus)) {
    return 'upsert';
  } else if (DELETE_ACTIONS.has(action) && (TERMINAL_STATES.has(normalizedStatus) || normalizedStatus === 'requested')) {
    return 'delete';
  }
  return 'conflict';
}

/** Sync status stored after a successful delete. */
export function statusAfterDelete(sessionStatus: string): 'cancelled' | 'not_synced' {
  return sessionStatus.trim().toLowerCase() === 'requested' ? 'not_synced' : 'cancelled';
}

/** Exponential backoff after the given (1-based) failed attempt: 5, 10, 20, 40, 80, 120 minutes. */
export function calendarRetryDelayMinutes(attempts: number): number {
  const step = Number.isFinite(attempts) ? Math.max(1, Math.floor(attempts)) : 1;
  return Math.min(RETRY_CAP_MINUTES, RETRY_BASE_MINUTES * 2 ** (Math.min(step, 16) - 1));
}

/** Values stored for a failed sync. NULL next attempt = retries exhausted (admin can retry). */
export function calendarFailureUpdate(attempts: number, error: string, now: Date): Record<string, unknown> {
  const exhausted = attempts >= CALENDAR_SYNC_MAX_ATTEMPTS;
  return {
    calendar_sync_status: 'failed',
    calendar_sync_error: error,
    calendar_next_attempt_at: exhausted
      ? null
      : new Date(now.getTime() + calendarRetryDelayMinutes(attempts) * 60_000).toISOString(),
  };
}

/** Values stored when a live session is dispatched: try later; this was not a failed attempt. */
export function calendarDeferredUpdate(attempts: number, now: Date): Record<string, unknown> {
  return {
    calendar_sync_status: 'pending',
    calendar_sync_error: null,
    calendar_sync_attempts: Math.max(0, Math.floor(Number.isFinite(attempts) ? attempts : 0) - 1),
    calendar_next_attempt_at: new Date(now.getTime() + CALENDAR_LIVE_RETRY_MINUTES * 60_000).toISOString(),
  };
}
