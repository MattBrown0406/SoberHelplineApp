import { supabase } from './supabase';
import { isLaSobremesaSession } from './familySquaresSchedule';

/**
 * La Sobremesa (AyudaSobria.com's Spanish Monday call, 8:00 PM Pacific) uses Zoom
 * registration: each family has a personal link instead of the session's shared
 * zoom_url. Members see it only when the app is in Spanish (sessions.language).
 */

/** A personal link stays usable until the call (75 minutes) is over. */
const CALL_LENGTH_MS = 75 * 60_000;

export function personalLinkIsCurrent(startsAt: string | null | undefined, now = Date.now()): boolean {
  const start = startsAt ? Date.parse(startsAt) : NaN;
  return Number.isFinite(start) && start + CALL_LENGTH_MS > now;
}

/**
 * Gives La Sobremesa rows the member's own join link (from session_join_links) in
 * zoom_url, so every Join button opens it. Other rows are returned unchanged.
 */
export async function withPersonalLinks<T extends { id: string; title: string; zoom_url: string | null }>(
  rows: T[],
): Promise<T[]> {
  const ids = rows.filter((row) => isLaSobremesaSession(row)).map((row) => row.id);
  if (!ids.length) return rows;
  const { data } = await supabase
    .from('session_join_links')
    .select('session_id, join_url, starts_at')
    .in('session_id', ids);
  const links = new Map(
    (data ?? [])
      .filter((link) => personalLinkIsCurrent(link.starts_at as string))
      .map((link) => [link.session_id as string, link.join_url as string]),
  );
  return rows.map((row) => (isLaSobremesaSession(row) ? { ...row, zoom_url: links.get(row.id) ?? null } : row));
}

export type ReserveResult =
  | { ok: true; joinUrl: string }
  | { ok: false; reason: 'not_available' | 'error' };

/**
 * Reserves the member's place: AyudaSobria registers their verified email with
 * Zoom, emails the link, and the app keeps the link and a "going" RSVP.
 */
export async function reserveLaSobremesa(): Promise<ReserveResult> {
  try {
    const { data, error } = await supabase.functions.invoke('la-sobremesa-register', { body: {} });
    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status;
      return { ok: false, reason: status === 404 ? 'not_available' : 'error' };
    }
    const joinUrl = (data as { joinUrl?: unknown } | null)?.joinUrl;
    return typeof joinUrl === 'string' && joinUrl.startsWith('https://')
      ? { ok: true, joinUrl }
      : { ok: false, reason: 'error' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
