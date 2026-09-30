// The Family Squares meets Mondays at 7:00 PM Pacific. Cron runs in UTC, so
// reminder jobs are scheduled at both possible UTC hours (PDT and PST) and
// each run sends only when it is actually the intended Pacific time.

const PACIFIC = 'America/Los_Angeles';

export function pacificWeekdayHour(now: Date): { weekday: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC,
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN);
  return { weekday, hour };
}

/** True during the Monday 6 PM Pacific hour, the hour before the call. */
export function isFamilySquaresReminderHour(now: Date): boolean {
  const { weekday, hour } = pacificWeekdayHour(now);
  return weekday === 'Mon' && hour === 18;
}
