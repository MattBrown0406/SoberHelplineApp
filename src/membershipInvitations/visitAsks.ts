/**
 * One ask per visit. A "visit" lasts until the app next leaves the foreground
 * (clearVisitAsks, called from clearMeetingReturn in afterMeetingInvite, which
 * the app layout calls then and when the account changes).
 *
 * Other asks report here, in one place, instead of each invitation placement
 * checking them itself:
 * - the App Store rating prompt (src/lib/reviewPrompt.ts): while its check is
 *   running it counts as asked, and once it was requested (or a check failed
 *   part-way and may have shown it) it counts for the rest of the visit;
 * - the reminder ask (Today's card, app/(tabs)/index.tsx).
 *
 * A membership invitation is never claimed on a visit that had one of them
 * (policy.ts, askedThisVisit). Nothing is stored and nothing is logged.
 *
 * Pure (no device imports), so it runs in unit tests.
 */
const asked = new Set<string>();
const pending = new Map<string, number>();

/** Another ask was on screen (or may have been) on this visit, for this account. */
export function noteVisitAsk(accountId: string | null | undefined): void {
  if (accountId) asked.add(accountId);
}

/** The rating-prompt check started (true) or finished (false) for this account. */
export function noteReviewPending(accountId: string | null | undefined, running: boolean): void {
  if (!accountId) return;
  const next = (pending.get(accountId) ?? 0) + (running ? 1 : -1);
  if (next > 0) pending.set(accountId, next);
  else pending.delete(accountId);
}

/** True when an invitation must not be offered on this visit. */
export function askedThisVisit(accountId: string | null | undefined): boolean {
  return !accountId || asked.has(accountId) || pending.has(accountId);
}

/** The visit is over. A rating-prompt check still running keeps counting until it ends. */
export function clearVisitAsks(): void {
  asked.clear();
}
