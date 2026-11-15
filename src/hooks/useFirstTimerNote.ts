import { useCallback, useEffect, useRef, useState } from 'react';
import {
  firstTimerNoteWanted,
  markFamilySquaresJoined,
  subscribeFirstTimerNoteHidden,
} from '../lib/familySquaresFirstTimer';
import { accountIsNewForFirstTimerNote } from '../lib/familySquaresCard';

/**
 * Whether to show "What to expect" for Family Squares: only to an account
 * created in the last 30 days (`joinedAt`) that has not hidden it and has not
 * tapped Join before (kept on this device). Hidden until that is known, so it
 * never flashes at someone who has been.
 */
export function useFirstTimerNote(accountId: string | null, joinedAt: string | null | undefined) {
  const [visible, setVisible] = useState(false);
  const identity = useRef(accountId);
  identity.current = accountId;

  useEffect(() => {
    setVisible(false);
    // A long-standing member is not a first-timer, whatever this device has stored.
    if (!accountId || !accountIsNewForFirstTimerNote(joinedAt)) return;
    let active = true;
    void firstTimerNoteWanted(accountId).then((wanted) => {
      if (active) setVisible(wanted);
    });
    return () => { active = false; };
  }, [accountId, joinedAt]);

  useEffect(() => subscribeFirstTimerNoteHidden((hiddenFor) => {
    if (hiddenFor === identity.current) setVisible(false);
  }), []);

  const dismiss = useCallback(() => {
    setVisible(false);
    if (accountId) void markFamilySquaresJoined(accountId).catch(() => undefined);
  }, [accountId]);

  return { visible, dismiss };
}
