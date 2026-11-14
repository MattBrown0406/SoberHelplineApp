/**
 * The moment for the after-Family-Squares invitation.
 *
 * A free member who comes back to the app at least ten minutes into the
 * meeting and ten minutes after tapping Join (the same signal that logs
 * `attended_10min`; never before the meeting starts) may be shown one soft
 * invitation on Today: keep talking with a coach between Mondays.
 *
 * It never shares a visit with the App Store rating prompt. Coming back from
 * the meeting is also when the rating prompt may be requested (on Today,
 * about a second after she returns), so the invitation waits until that check
 * has finished and shows only if no prompt was requested. A check that failed
 * part-way may have put the prompt on screen, so it counts as requested.
 *
 * Who may see it (free members only), how often (once every 14 days at most)
 * and "Don't show again" are decided by ContextualMembershipInvitation and
 * its policy; this file only knows that the moment has come. Nothing is
 * stored: the moment lasts until the app next leaves the foreground.
 *
 * Pure (no device imports), so it runs in unit tests.
 */
export type ReviewCheckOutcome = 'requested' | 'not_eligible' | 'unavailable' | 'failed' | 'none';

type Moment = { accountId: string; review: 'waiting' | 'clear' | 'prompted' };

let moment: Moment | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/** She is back from the meeting: attendance was just logged for this account. */
export function noteMeetingReturn(accountId: string): void {
  moment = { accountId, review: 'waiting' };
  emit();
}

/**
 * The rating-prompt check that follows her return has finished. A check that
 * finished before the return was noted says nothing about this visit and is
 * ignored (noteMeetingReturn starts the wait).
 */
export function noteReviewCheck(accountId: string, outcome: ReviewCheckOutcome): void {
  if (!moment || moment.accountId !== accountId || moment.review !== 'waiting') return;
  const promptMayHaveShown = outcome === 'requested' || outcome === 'failed';
  moment = { accountId, review: promptMayHaveShown ? 'prompted' : 'clear' };
  emit();
}

/** The app left the foreground (or the account changed): the moment has passed. */
export function clearMeetingReturn(): void {
  if (!moment) return;
  moment = null;
  emit();
}

/** True while the invitation may be offered to this account on this visit. */
export function afterMeetingInviteReady(accountId: string | null | undefined): boolean {
  return !!accountId && moment?.accountId === accountId && moment.review === 'clear';
}

export function subscribeAfterMeetingInvite(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
