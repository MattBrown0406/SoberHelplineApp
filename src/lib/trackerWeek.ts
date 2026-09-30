import { toDateStr } from '../storage/checkIn';

/** Monday (YYYY-MM-DD) of the current week in the member's own timezone. */
export function getWeekStart(now: Date = new Date(), timezone?: string): string {
  const [y, m, d] = toDateStr(now, timezone).split('-').map(Number);
  const local = new Date(Date.UTC(y, m - 1, d));
  const day = local.getUTCDay();
  local.setUTCDate(local.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return local.toISOString().slice(0, 10);
}
