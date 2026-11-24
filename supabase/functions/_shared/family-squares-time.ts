// The Family Squares meets Mondays at 7:00 PM Pacific. Cron runs in UTC, so
// reminder jobs are scheduled at both possible UTC hours (PDT and PST) and
// each run sends only when it is actually the intended Pacific time.

const PACIFIC = 'America/Los_Angeles';

/**
 * The 0-23 hour of formatToParts output. This also runs on the phone (Hermes):
 * an engine that ignores hourCycle may answer on a 12-hour clock or say "24"
 * at midnight, and either would shift the Monday date by half a day.
 */
function hour24(parts: Intl.DateTimeFormatPart[]): number {
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN);
  const period = parts.find((p) => p.type === 'dayPeriod')?.value;
  if (period) return (hour % 12) + (/^p/i.test(period.trim()) ? 12 : 0);
  return hour % 24;
}

export function pacificWeekdayHour(now: Date): { weekday: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC,
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  return { weekday, hour: hour24(parts) };
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
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour24(parts), get('minute'), get('second'));
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

/** The Pacific calendar date (YYYY-MM-DD) of an instant. */
export function pacificDate(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * The call soberhelpline.com should hear about: the next call that hasn't
 * ended (tonight's during the call), its Pacific date, and when the call
 * before it ended (that Monday, 8:00 PM Pacific). RSVPs and questions made
 * after the previous call ended belong to this one.
 */
export function familySquaresSyncWindow(now: Date): { meetingDate: string; start: Date; previousCallEnd: Date } {
  const start = nextFamilySquaresStart(now);
  const meetingDate = pacificDate(start);
  const [year, month, day] = meetingDate.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day) - 7 * 86_400_000);
  const previousCallEnd = zonedInstant(
    previous.getUTCFullYear(), previous.getUTCMonth() + 1, previous.getUTCDate(), 20, PACIFIC,
  );
  return { meetingDate, start, previousCallEnd };
}

/** Why a website Monday link was not accepted (never the link itself, so it can be logged). */
export type ZoomJoinUrlRejection = 'missing' | 'malformed' | 'not_https' | 'host' | 'path';

/**
 * Checks a soberhelpline.com Monday link. Accepted: https on zoom.us or any
 * subdomain of it (us06web.zoom.us), no credentials or port, and a join path:
 * /j/<meeting id>, /w/<meeting id> or /wc/join/<meeting id> (the shapes the
 * website's admin form allows). Any query (pwd, tk, uname...) and fragment are
 * kept as they are. Null when accepted.
 */
export function zoomJoinUrlRejection(value: unknown): ZoomJoinUrlRejection | null {
  if (typeof value !== 'string' || !value.trim()) return 'missing';
  const raw = value.trim();
  // A real link has no spaces, quotes or angle brackets, and is not huge.
  if (raw.length > 2048 || /[\s"'<>`\\]/.test(raw)) return 'malformed';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'malformed';
  }
  if (url.protocol !== 'https:') return 'not_https';
  if (url.username || url.password || url.port) return 'host';
  const host = url.hostname.toLowerCase();
  if (host !== 'zoom.us' && !/^([a-z0-9-]+\.)+zoom\.us$/.test(host)) return 'host';
  if (!/^\/(?:j|w|wc\/join)\/\d{9,12}\/?$/.test(url.pathname)) return 'path';
  return null;
}

/** A soberhelpline.com Monday link the app can safely open (a Zoom join URL), trimmed; else null. */
export function validZoomJoinUrl(value: unknown): string | null {
  return zoomJoinUrlRejection(value) === null ? (value as string).trim() : null;
}
