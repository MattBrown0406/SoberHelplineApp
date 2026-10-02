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

function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant of a wall-clock time in a zone (handles PDT/PST). */
function zonedInstant(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, 0, 0);
  const first = guess - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - zoneOffsetMs(new Date(first), timeZone));
}

/**
 * Start of the next Family Squares call (Monday 7:00 PM Pacific) that hasn't
 * ended yet (calls run an hour), so Monday evening still shows tonight's call.
 */
export function nextFamilySquaresStart(now: Date): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const base = Date.UTC(get('year'), get('month') - 1, get('day'));
  for (let days = 0; days <= 7; days += 1) {
    const day = new Date(base + days * 86_400_000);
    if (day.getUTCDay() !== 1) continue;
    const start = zonedInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 19, PACIFIC);
    if (start.getTime() + 60 * 60_000 > now.getTime()) return start;
  }
  const nextWeek = new Date(base + 7 * 86_400_000);
  return zonedInstant(nextWeek.getUTCFullYear(), nextWeek.getUTCMonth() + 1, nextWeek.getUTCDate(), 19, PACIFIC);
}

/** A soberhelpline.com Monday link the app can safely open (a Zoom join URL). */
export function validZoomJoinUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  return /^https:\/\/([a-z0-9-]+\.)?zoom\.us\/j\/\d{9,12}(\?pwd=[A-Za-z0-9._-]+)?$/.test(url) ? url : null;
}
