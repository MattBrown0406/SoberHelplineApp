import { toDateStr } from '../storage/checkIn';

function parse(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Shifts a YYYY-MM-DD calendar date by whole days. Pure calendar math, so DST never skips or repeats a day. */
export function shiftDateStr(dateStr: string, days: number): string {
  const date = parse(dateStr);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The last `count` calendar days in the account timezone, oldest first, ending
 * today. These match `checkins.checkin_date`, which the server derives in the
 * same account timezone.
 */
export function recentLocalDays(count: number, timezone?: string, now: Date = new Date()): string[] {
  const today = toDateStr(now, timezone);
  return Array.from({ length: count }, (_, i) => shiftDateStr(today, i - (count - 1)));
}

/** Day of week (0 = Sunday … 6 = Saturday) of a YYYY-MM-DD calendar date. */
export function weekdayOf(dateStr: string): number {
  return parse(dateStr).getUTCDay();
}
