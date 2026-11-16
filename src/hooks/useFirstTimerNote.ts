import { useCallback, useEffect, useRef, useState } from 'react';
import {
  firstTimerNoteStartsOpen,
  firstTimerNoteWanted,
  foldFirstTimerNote,
  markFirstTimerNoteSeen,
  subscribeFirstTimerNote,
} from '../lib/familySquaresFirstTimer';
import { accountIsNewForFirstTimerNote } from '../lib/familySquaresCard';

/**
 * Whether to show "What to expect" for Family Squares: only to an account
 * created in the last 30 days (`joinedAt`) that has not tapped Join before
 * (kept on this device). Hidden until that is known, so it never flashes at
 * someone who has been.
 *
 * `open`: the first time it is shown it is open; after that (or after
 * "Got it") it is one line that opens it again. `alwaysStartsOpen` is for the
 * onboarding done screen, which shows it open and counts as that first time.
 */
export function useFirstTimerNote(accountId: string | null, joinedAt: string | null | undefined, alwaysStartsOpen = false) {
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const identity = useRef(accountId);
  identity.current = accountId;

  useEffect(() => {
    setVisible(false);
    setOpen(false);
    // A long-standing member is not a first-timer, whatever this device has stored.
    if (!accountId || !accountIsNewForFirstTimerNote(joinedAt)) return;
    let active = true;
    void firstTimerNoteWanted(accountId).then(async (wanted) => {
      if (!wanted) return;
      if (alwaysStartsOpen) void markFirstTimerNoteSeen(accountId);
      const startsOpen = alwaysStartsOpen || await firstTimerNoteStartsOpen(accountId);
      if (!active) return;
      setOpen(startsOpen);
      setVisible(true);
    });
    return () => { active = false; };
  }, [accountId, joinedAt, alwaysStartsOpen]);

  useEffect(() => subscribeFirstTimerNote((changedFor, change) => {
    if (changedFor !== identity.current) return;
    if (change === 'joined') setVisible(false);
    else setOpen(false);
  }), []);

  /** "Got it": folded to one line here and on every other screen, from now on. */
  const dismiss = useCallback(() => {
    setOpen(false);
    if (accountId) void foldFirstTimerNote(accountId);
  }, [accountId]);

  const expand = useCallback(() => setOpen(true), []);

  return { visible, open, dismiss, expand };
}
