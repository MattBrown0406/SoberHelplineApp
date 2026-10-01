// Admin-facing summary of a video session's Google Calendar sync (English:
// admin screens are English-only). Mirrors the dispatcher's retry policy in
// supabase/functions/_shared/calendar-sync-retry.ts.

export const CALENDAR_SYNC_MAX_ATTEMPTS = 6;

export type CalendarSyncFields = {
  status: string;
  calendar_sync_status: string;
  calendar_sync_error: string | null;
  calendar_synced_at: string | null;
  calendar_sync_attempts: number | null;
  calendar_next_attempt_at: string | null;
};

export type CalendarSyncSummary = {
  tone: 'ok' | 'pending' | 'failed' | 'none';
  label: string;
  detail: string | null;
  canRetry: boolean;
};

function shortTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function calendarSyncSummary(session: CalendarSyncFields): CalendarSyncSummary {
  const attempts = Math.max(0, session.calendar_sync_attempts ?? 0);
  switch (session.calendar_sync_status) {
    case 'synced': {
      const at = shortTime(session.calendar_synced_at);
      return { tone: 'ok', label: 'Calendar: synced', detail: at ? `Last synced ${at}` : null, canRetry: false };
    }
    case 'pending':
    case 'processing': {
      const next = shortTime(session.calendar_next_attempt_at);
      return {
        tone: 'pending',
        label: 'Calendar: sync pending',
        detail: next ? `Next try ${next}` : 'Syncs within about 2 minutes',
        canRetry: false,
      };
    }
    case 'failed': {
      const exhausted = attempts >= CALENDAR_SYNC_MAX_ATTEMPTS;
      const next = shortTime(session.calendar_next_attempt_at);
      const retryText = exhausted
        ? `Gave up after ${attempts} attempt${attempts === 1 ? '' : 's'}`
        : `Attempt ${attempts} of ${CALENDAR_SYNC_MAX_ATTEMPTS} · ${next ? `automatic retry ${next}` : 'retrying within about 2 minutes'}`;
      const error = session.calendar_sync_error?.trim();
      return {
        tone: 'failed',
        label: 'Calendar: sync failed',
        detail: error ? `${retryText} — ${error}` : retryText,
        canRetry: true,
      };
    }
    case 'cancelled':
      return { tone: 'none', label: 'Calendar: event removed', detail: null, canRetry: false };
    default:
      // A confirmed session that never reached the calendar can be queued by hand.
      return session.status === 'scheduled'
        ? { tone: 'failed', label: 'Calendar: not synced', detail: null, canRetry: true }
        : { tone: 'none', label: 'Calendar: not on the calendar yet', detail: null, canRetry: false };
  }
}
