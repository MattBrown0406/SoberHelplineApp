import AsyncStorage from '@react-native-async-storage/async-storage';
import { isFamilySquaresSession } from './familySquaresSchedule';

/**
 * Which session row is Family Squares, remembered on the device.
 *
 * A reminder push names only a session id. Knowing which id is Family Squares
 * lets a tap on any OTHER session's reminder (La Sobremesa, a group) open at
 * once, with no network lookup first (familySquaresPushJoin). The id is the
 * same for everyone and says nothing about the member, so it is not tied to
 * an account and stays through sign-out.
 */
const KEY = '@sh:family-squares:session-id';
const ID_PATTERN = /^[0-9a-f-]{36}$/i;

let known: string | null = null;

/** Called wherever the app has just loaded sessions (Today, Support, a reminder lookup). Never throws. */
export function rememberFamilySquaresSession(sessions: ReadonlyArray<{ id?: string | null; title?: string | null }> | null | undefined): void {
  const id = sessions?.find((session) => isFamilySquaresSession(session))?.id;
  if (typeof id !== 'string' || !ID_PATTERN.test(id) || id === known) return;
  known = id;
  void AsyncStorage.setItem(KEY, id).catch(() => undefined);
}

/** The remembered id, or null when this device has not seen the session list yet. Never throws. */
export async function knownFamilySquaresSessionId(): Promise<string | null> {
  if (known) return known;
  try {
    const stored = await AsyncStorage.getItem(KEY);
    // Something loaded while this was reading wins.
    if (!known && stored && ID_PATTERN.test(stored)) known = stored;
  } catch {
    // Unreadable: not known.
  }
  return known;
}
