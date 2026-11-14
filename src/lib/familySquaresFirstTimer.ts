import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * "What to expect" is for someone who has never been to Family Squares. The
 * signal is kept on the device: set when she hides the note or first taps
 * Join. (A new phone shows the note once more; it is one tap to hide.)
 * The key carries the account id, so sign-out clears it with her other data.
 */
const KEY_PREFIX = '@sh:family-squares-first-note:';

type Listener = (accountId: string) => void;
const listeners = new Set<Listener>();

function key(accountId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(accountId)}`;
}

/** True until she hides the note or joins once. A failed read hides it: never nag on a guess. */
export async function firstTimerNoteWanted(accountId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(key(accountId))) === null;
  } catch {
    return false;
  }
}

/** Hide the note for good on this device, on every screen that shows it. */
export async function markFamilySquaresJoined(accountId: string): Promise<void> {
  for (const listener of [...listeners]) {
    try {
      listener(accountId);
    } catch {
      // One screen failing must not stop the others.
    }
  }
  await AsyncStorage.setItem(key(accountId), 'done');
}

/** Today and Support both stay mounted: hiding the note on one hides it on the other. */
export function subscribeFirstTimerNoteHidden(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
