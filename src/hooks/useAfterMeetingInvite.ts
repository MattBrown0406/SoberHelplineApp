import { useCallback, useRef, useSyncExternalStore } from 'react';
import { afterMeetingInviteReady, subscribeAfterMeetingInvite } from '../lib/afterMeetingInvite';

/**
 * True on the visit when this account has just come back from Family Squares
 * and no rating prompt was requested (afterMeetingInvite). Starts false and
 * turns true at that moment, which is what ContextualMembershipInvitation
 * needs: it only ever offers itself on a false-to-true change.
 *
 * One ask at a time: if another ask (the welcome-back card, the reminder
 * note) is on screen when the moment comes, the moment is let go rather than
 * queued up behind it.
 */
export function useAfterMeetingInvite(accountId: string | null, otherAskShowing: boolean): boolean {
  const read = useCallback(() => afterMeetingInviteReady(accountId), [accountId]);
  const ready = useSyncExternalStore(subscribeAfterMeetingInvite, read, read);
  const moment = useRef<{ allowed: boolean } | null>(null);
  if (!ready) moment.current = null;
  else if (!moment.current) moment.current = { allowed: !otherAskShowing };
  return ready && !!moment.current?.allowed;
}
