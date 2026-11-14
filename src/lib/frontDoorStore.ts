import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  SIGNED_IN_BEFORE_KEY,
  SIGN_UP_SUBMITTED_KEY,
  hasEarlierSignInTrace,
  parseSignedInBefore,
  type FrontDoorFlags,
} from './frontDoor';

// Whether anyone has signed in on this device, and whether a sign-up was sent
// from it. Not sensitive: each holds '1' and nothing about who it was.
let known: boolean | null = null;
let submitted: boolean | null = null;

/** Never throws. An unreadable store answers "never", so a new person still gets sign-up. */
export async function readFrontDoorFlags(): Promise<FrontDoorFlags> {
  if (known === null) {
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
  }
  if (submitted === null) {
    let stored = false;
    try {
      stored = parseSignedInBefore(await AsyncStorage.getItem(SIGN_UP_SUBMITTED_KEY));
    } catch {
      // Unreadable: "never".
    }
    // A sign-up sent while this was reading wins.
    submitted = submitted ?? stored;
  }
  return { signedInBefore: known, signUpSubmitted: submitted };
}

/** Called once a session exists. Remembered for this run even if storage fails. */
export function markSignedInBefore(): void {
  if (known === true) return;
  known = true;
  void AsyncStorage.setItem(SIGNED_IN_BEFORE_KEY, '1').catch(() => undefined);
}

/**
 * Called the moment creating an account succeeds (no session yet: the address
 * still has to be confirmed). Next time the app opens signed out, it opens on
 * sign-in. Remembered for this run even if storage fails.
 */
export function markSignUpSubmitted(): void {
  if (submitted === true) return;
  submitted = true;
  void AsyncStorage.setItem(SIGN_UP_SUBMITTED_KEY, '1').catch(() => undefined);
}

// Whether she has started filling in "Create your account" (in memory only,
// a yes/no and nothing she typed). The root layout asks before it moves her
// off that screen for a late answer from the device store.
let formStarted = false;

export function noteSignUpFormStarted(started: boolean): void {
  formStarted = started;
}

export function signUpFormStarted(): boolean {
  return formStarted;
}
