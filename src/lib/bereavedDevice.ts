import AsyncStorage from '@react-native-async-storage/async-storage';
import { bereavedCacheKey } from './bereavement';

/**
 * The device's copy of "her loved one died", kept by useLovedOne on Today
 * (which is always mounted) and read by every screen that must stay quiet for
 * a bereaved member: no sales prompts, no membership invitations.
 *
 * Three answers: true, false, or undefined when this device does not know yet
 * (a new phone before the first read, or storage that cannot be read). The
 * screens that sell treat "not known" as "do not show".
 */

type Listener = (accountId: string, bereaved: boolean) => void;
const listeners = new Set<Listener>();
// What this run of the app already knows, so a screen can answer at once.
const known = new Map<string, boolean>();

/** Written whenever her record is read or changed. '0' is an answer too: a missing key means "not known yet". */
export function rememberBereavedOnDevice(accountId: string, bereaved: boolean): void {
  known.set(accountId, bereaved);
  void AsyncStorage.setItem(bereavedCacheKey(accountId), bereaved ? '1' : '0').catch(() => undefined);
  for (const listener of [...listeners]) {
    try {
      listener(accountId, bereaved);
    } catch {
      // One screen failing must not stop the others.
    }
  }
}

/** What is known without waiting, or undefined. */
export function knownBereavedOnDevice(accountId: string): boolean | undefined {
  return known.get(accountId);
}

/** The device's answer, or undefined when it has none. Never throws. */
export async function loadBereavedOnDevice(accountId: string): Promise<boolean | undefined> {
  if (known.has(accountId)) return known.get(accountId);
  try {
    const stored = await AsyncStorage.getItem(bereavedCacheKey(accountId));
    // Something read from the server while this was reading wins.
    if (known.has(accountId)) return known.get(accountId);
    return bereavedFromStored(stored);
  } catch {
    return undefined;
  }
}

/** '1' is bereaved, '0' is not; anything else is "not known". */
export function bereavedFromStored(stored: string | null | undefined): boolean | undefined {
  return stored === '1' ? true : stored === '0' ? false : undefined;
}

/**
 * Whether a sales prompt or membership invitation may be shown, as far as
 * bereavement goes: only when the device KNOWS she is not bereaved.
 */
export function salesAllowedForBereavement(bereaved: boolean | undefined): boolean {
  return bereaved === false;
}

export function subscribeBereavedOnDevice(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
