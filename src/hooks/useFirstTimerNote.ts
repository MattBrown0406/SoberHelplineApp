import { useCallback, useEffect, useRef, useState } from 'react';
import {
  firstTimerNoteWanted,
  markFamilySquaresJoined,
  subscribeFirstTimerNoteHidden,
} from '../lib/familySquaresFirstTimer';

/**
 * Whether to show "What to expect" for Family Squares: only to someone who
 * has not hidden it and has not tapped Join before (kept on this device).
 * Hidden until that is known, so it never flashes at someone who has been.
 */
export function useFirstTimerNote(accountId: string | null) {
  const [visible, setVisible] = useState(false);
  const identity = useRef(accountId);
  identity.current = accountId;

  useEffect(() => {
    setVisible(false);
    if (!accountId) return;
    let active = true;
    void firstTimerNoteWanted(accountId).then((wanted) => {
      if (active) setVisible(wanted);
    });
    return () => { active = false; };
  }, [accountId]);

  useEffect(() => subscribeFirstTimerNoteHidden((hiddenFor) => {
    if (hiddenFor === identity.current) setVisible(false);
  }), []);

  const dismiss = useCallback(() => {
    setVisible(false);
    if (accountId) void markFamilySquaresJoined(accountId).catch(() => undefined);
  }, [accountId]);

  return { visible, dismiss };
}
