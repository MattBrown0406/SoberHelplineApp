/**
 * The Family Squares (the free Monday call, 7:00 PM Pacific). The backend keeps
 * `sessions.next_at` on the next call's start, so the app can show the real
 * time in the member's own time zone instead of a fixed label.
 */

/** Production title, plus the title older seeds used (never key on one alone). */
export const FAMILY_SQUARES_TITLES: ReadonlySet<string> = new Set(['The Family Squares', 'Monday Night Family Support']);

/** A call is still "next" until it has run its hour. */
const CALL_LENGTH_MS = 60 * 60_000;

export function isFamilySquaresSession(session: { title?: string | null } | null | undefined): boolean {
  return !!session?.title && FAMILY_SQUARES_TITLES.has(session.title.trim());
}

function parseInstant(value: string): number {
  // Postgres text form ("2026-10-06 02:00:00+00") → ISO, which Hermes parses reliably.
  const iso = value
    .trim()
    .replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/, '$1T$2')
    .replace(/([+-]\d{2})$/, '$1:00');
  return Date.parse(iso);
}

/**
 * The next call's start in the member's time zone ("Mon, Oct 5, 7:00 PM PDT"),
 * or null when `nextAt` is missing, unparseable, or already over (the caller
 * then shows the fixed "Mondays 7:00 PM Pacific" fallback).
 */
export function formatNextCallTime(
  nextAt: string | null | undefined,
  options: { now?: Date; locale?: string; timeZone?: string | null } = {},
): string | null {
  if (!nextAt) return null;
  const start = parseInstant(nextAt);
  if (!Number.isFinite(start)) return null;
  const now = (options.now ?? new Date()).getTime();
  if (start + CALL_LENGTH_MS <= now) return null;
  const format = (timeZone?: string) => new Intl.DateTimeFormat(options.locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(start));
  try {
    return format(options.timeZone ?? undefined);
  } catch {
    // An unknown zone name: the device's own zone is the next best thing.
    try {
      return format();
    } catch {
      return null;
    }
  }
}

/** True from the call's start until its hour is over. */
export function isCallInProgress(nextAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!nextAt) return false;
  const start = parseInstant(nextAt);
  if (!Number.isFinite(start)) return false;
  const at = now.getTime();
  return start <= at && at < start + CALL_LENGTH_MS;
}

/**
 * The free call Today offers: The Family Squares while it is on (its start
 * has passed but its hour has not — the member can still join), else the
 * soonest upcoming group call, else the soonest one listed. `sessions` is
 * ordered by next_at.
 */
export function chooseFreeCall<T extends { title?: string | null; next_at: string | null }>(
  sessions: readonly T[],
  now: Date = new Date(),
): T | null {
  const live = sessions.find((session) => isFamilySquaresSession(session) && isCallInProgress(session.next_at, now));
  if (live) return live;
  const upcoming = sessions.find((session) => {
    if (!session.next_at) return false;
    const start = parseInstant(session.next_at);
    return Number.isFinite(start) && start >= now.getTime();
  });
  return upcoming ?? sessions[0] ?? null;
}
