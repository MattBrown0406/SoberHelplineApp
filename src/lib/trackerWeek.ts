import { toDateStr } from '../storage/checkIn';
import { shiftDateStr } from './localDays';

/** Monday (YYYY-MM-DD) of the current week in the member's own timezone. */
export function getWeekStart(now: Date = new Date(), timezone?: string): string {
  const [y, m, d] = toDateStr(now, timezone).split('-').map(Number);
  const local = new Date(Date.UTC(y, m - 1, d));
  const day = local.getUTCDay();
  local.setUTCDate(local.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return local.toISOString().slice(0, 10);
}

/**
 * The last `weeks` Mondays, oldest first, in her own time zone — the same
 * week keys the tracker writes (getWeekStart). UTC Mondays would run a week
 * ahead every Sunday evening in the Americas.
 */
export function trajectoryWeeks(now: Date, weeks: number, timezone?: string | null): string[] {
  const current = getWeekStart(now, timezone ?? undefined);
  return Array.from({ length: weeks }, (_, i) => shiftDateStr(current, -7 * (weeks - 1 - i)));
}
