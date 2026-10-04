/**
 * Today and Boundaries each show the family space (and the week's hold log),
 * and both tabs stay mounted. A change made on one screen — or a family_backup
 * notification about a relative's wall — asks every mounted copy to re-read.
 */
type Listener = (source: string | null) => void;

const listeners = new Set<Listener>();

/** Ask every mounted family-space reader to re-read. `source` skips the caller's own copy. */
export function requestFamilySpaceRefresh(source: string | null = null): void {
  for (const listener of [...listeners]) {
    try {
      listener(source);
    } catch {
      // One reader failing must not stop the others.
    }
  }
}

export function subscribeFamilySpaceRefresh(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Focus and foreground events arrive together; skip a re-read this soon after the last one started. */
export const FAMILY_SPACE_REFRESH_THROTTLE_MS = 2_000;

export function shouldRefreshFamilySpace(lastStartedAt: number | null, now = Date.now()): boolean {
  return lastStartedAt === null || now - lastStartedAt >= FAMILY_SPACE_REFRESH_THROTTLE_MS;
}
