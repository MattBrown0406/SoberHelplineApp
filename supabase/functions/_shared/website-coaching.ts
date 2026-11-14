// Coaching sessions a member booked on soberhelpline.com, as the website's
// app-coaching-bookings function reports them. Everything from the website is
// checked again here before it reaches the app: nothing but these fields, real
// dates, and a join link only when it is a real Zoom address.

export const MAX_WEBSITE_SESSIONS = 50;

export interface WebsiteCoachingSession {
  id: string;
  starts_at: string;
  ends_at: string;
  status: 'confirmed' | 'completed';
  kind: 'coaching' | 'intensive';
  provider_name: string;
  join_url: string | null;
}

function isoInstant(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** An https Zoom address, or null. */
export function zoomJoinUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)zoom\.us$/i.test(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

/** The usable sessions from the website's answer, soonest first. Anything malformed is dropped. */
export function parseWebsiteSessions(payload: unknown): WebsiteCoachingSession[] {
  const list = (payload as { sessions?: unknown } | null)?.sessions;
  if (!Array.isArray(list)) return [];
  const sessions: WebsiteCoachingSession[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 64 ? row.id : null;
    const startsAt = isoInstant(row.starts_at);
    const endsAt = isoInstant(row.ends_at);
    if (!id || seen.has(id) || !startsAt || !endsAt || endsAt <= startsAt) continue;
    if (row.status !== 'confirmed' && row.status !== 'completed') continue;
    seen.add(id);
    sessions.push({
      id,
      starts_at: startsAt,
      ends_at: endsAt,
      status: row.status,
      kind: row.kind === 'intensive' ? 'intensive' : 'coaching',
      provider_name: typeof row.provider_name === 'string' ? row.provider_name.trim().slice(0, 100) : '',
      join_url: zoomJoinUrl(row.join_url),
    });
  }
  return sessions.sort((a, b) => a.starts_at.localeCompare(b.starts_at)).slice(0, MAX_WEBSITE_SESSIONS);
}
