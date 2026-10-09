// La Sobremesa: AyudaSobria.com's Spanish Monday call, 8:00 PM Pacific. Unlike
// The Family Squares it uses Zoom registration, so every family has a personal
// join link, issued by AyudaSobria (/api/zoom/app-register, AYUDA_SYNC_SECRET).

export const AYUDA_APP_REGISTER_URL = 'https://ayudasobria.com/api/zoom/app-register';

/** A personal Zoom join link AyudaSobria may hand back (never a host/start link). */
export function validPersonalJoinUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  return /^https:\/\/([a-z0-9-]+\.)?zoom\.us\/(w|j)\/\d{9,12}\?[A-Za-z0-9._~%&=-]+$/.test(url) && url.length <= 600
    ? url
    : null;
}

export type AyudaRegistration =
  | { ok: true; joinUrl: string; startsAt: string }
  | { ok: false; status: 'not_available' | 'error' };

/** Validates AyudaSobria's answer; anything unexpected is an error, never a link. */
export function parseAyudaRegistration(status: number, body: unknown): AyudaRegistration {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  if (status === 404) return { ok: false, status: 'not_available' };
  if (status !== 200) return { ok: false, status: 'error' };
  const joinUrl = validPersonalJoinUrl(record.joinUrl);
  const startsAt = typeof record.startsAt === 'string' && Number.isFinite(Date.parse(record.startsAt))
    ? new Date(record.startsAt).toISOString()
    : null;
  return joinUrl && startsAt ? { ok: true, joinUrl, startsAt } : { ok: false, status: 'error' };
}

/** True during the Monday 7 PM Pacific hour, the hour before La Sobremesa. */
export function isLaSobremesaReminderHour(now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  return parts.find((p) => p.type === 'weekday')?.value === 'Mon' &&
    Number(parts.find((p) => p.type === 'hour')?.value) === 19;
}
