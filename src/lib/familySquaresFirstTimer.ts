import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * "What to expect" is for someone who has never been to Family Squares. Two
 * signals are kept on the device:
 * - joined: set when she first taps Join. The note is then gone for good.
 *   (Older builds also set it from "Got it"; for her it stays gone.)
 * - seen: set the first time the note is shown, and by "Got it". From then on
 *   the note is one line she can open again, not a tall block every time.
 * (A new phone shows the note open once more; it is one tap to fold.)
 * A missing key alone would make every long-standing member look new after
 * an update or on a new phone, so the note is also only for an account
 * created in the last 30 days (accountIsNewForFirstTimerNote, useFirstTimerNote).
 * Both keys carry the account id, so sign-out clears them with her other data.
 */
const KEY_PREFIX = '@sh:family-squares-first-note:';
const SEEN_KEY_PREFIX = '@sh:family-squares-first-note-seen:';

/** 'joined': gone for good. 'folded': one line from now on. */
export type FirstTimerNoteChange = 'joined' | 'folded';
type Listener = (accountId: string, change: FirstTimerNoteChange) => void;
const listeners = new Set<Listener>();

/**
 * Accounts whose note was first shown in this run of the app. It stays open
 * on every screen until "Got it": a screen that is drawn a second time a
 * moment later must not fold a note she has not read yet.
 */
const firstShownNow = new Set<string>();

function key(accountId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(accountId)}`;
}

function seenKey(accountId: string): string {
  return `${SEEN_KEY_PREFIX}${encodeURIComponent(accountId)}`;
}

function tell(accountId: string, change: FirstTimerNoteChange): void {
  for (const listener of [...listeners]) {
    try {
      listener(accountId, change);
    } catch {
      // One screen failing must not stop the others.
    }
  }
}

/** True until she joins once. A failed read hides it: never nag on a guess. */
export async function firstTimerNoteWanted(accountId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key(accountId))) === null;
  } catch {
    return false;
  }
}

/**
 * Whether the note is drawn open: only the first time it is shown on this
 * device (and for the rest of that run of the app, until "Got it"). Asking
 * records that it has now been seen. A failed read folds it: one line is
 * never a nag.
 */
export async function firstTimerNoteStartsOpen(accountId: string): Promise<boolean> {
  if (firstShownNow.has(accountId)) return true;
  try {
    if ((await AsyncStorage.getItem(seenKey(accountId))) !== null) return false;
  } catch {
    return false;
  }
  firstShownNow.add(accountId);
  await markFirstTimerNoteSeen(accountId);
  return true;
}

/** She has been shown the note (the onboarding done screen shows it open): the next screen folds it. */
export async function markFirstTimerNoteSeen(accountId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(seenKey(accountId), 'seen');
  } catch {
    // Not saved: it is shown open once more next time.
  }
}

/** "Got it": one line from now on, on every screen that shows it. */
export async function foldFirstTimerNote(accountId: string): Promise<void> {
  firstShownNow.delete(accountId);
  tell(accountId, 'folded');
  await markFirstTimerNoteSeen(accountId);
}

/** Hide the note for good on this device, on every screen that shows it. */
export async function markFamilySquaresJoined(accountId: string): Promise<void> {
  tell(accountId, 'joined');
  await AsyncStorage.setItem(key(accountId), 'done');
}

/** Today and Support both stay mounted: folding or hiding the note on one does it on the other. */
export function subscribeFirstTimerNote(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
