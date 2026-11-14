import AsyncStorage from '@react-native-async-storage/async-storage';
import { SIGNED_IN_BEFORE_KEY, hasEarlierSignInTrace, parseSignedInBefore } from './frontDoor';

// Whether anyone has signed in on this device. Not sensitive: it holds '1' and
// nothing about who it was.
let known: boolean | null = null;

/** Never throws. An unreadable store answers "never", so a new person still gets sign-up. */
export async function readSignedInBefore(): Promise<boolean> {
  if (known !== null) return known;
  let stored = false;
  try {
    stored = parseSignedInBefore(await AsyncStorage.getItem(SIGNED_IN_BEFORE_KEY));
    if (!stored && hasEarlierSignInTrace(await AsyncStorage.getAllKeys())) {
      stored = true;
      await AsyncStorage.setItem(SIGNED_IN_BEFORE_KEY, '1');
    }
  } catch {
    // Keep whatever was read before the failure.
  }
  // A sign-in that finished while this was reading wins.
  known = known ?? stored;
  return known;
}

/** Called once a session exists. Remembered for this run even if storage fails. */
export function markSignedInBefore(): void {
  if (known === true) return;
  known = true;
  void AsyncStorage.setItem(SIGNED_IN_BEFORE_KEY, '1').catch(() => undefined);
}
