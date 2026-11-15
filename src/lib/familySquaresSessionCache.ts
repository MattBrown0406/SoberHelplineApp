import AsyncStorage from '@react-native-async-storage/async-storage';
import { isFamilySquaresSession } from './familySquaresSchedule';

/**
 * Which session row is Family Squares, remembered on the device.
 *
 * A reminder push names only a session id. Knowing which id is Family Squares,
 * and which ids are other sessions, lets a tap on any OTHER session's reminder
 * (La Sobremesa, a group) open at once, with no network lookup first
 * (familySquaresPushJoin). Only session ids are kept: the same rows for
 * everyone, nothing about the member, so they are not tied to an account and
 * stay through sign-out.
 */
const KEY = '@sh:family-squares:session-id';
/** The other sessions this device has seen in a loaded list (ids only). */
const OTHERS_KEY = '@sh:family-squares:other-session-ids';
const ID_PATTERN = /^[0-9a-f-]{36}$/i;
/** More than enough for the session list; keeps the stored value small. */
const MAX_OTHERS = 40;

let known: string | null = null;
// Sessions the device KNOWS are something else (La Sobremesa, a group): they
// were in a loaded session list under another title. A reminder for one of
// these opens at once; a reminder for an id that is in neither place is not
// assumed to be "another session" (the Family Squares row may have changed
// since this device last loaded the list): it is looked up.
let others: Set<string> | null = null;

function sameIds(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/** Called wherever the app has just loaded sessions (Today, Support, a reminder lookup). Never throws. */
export function rememberFamilySquaresSession(sessions: ReadonlyArray<{ id?: string | null; title?: string | null }> | null | undefined): void {
  if (!sessions) return;
  const id = sessions.find((session) => isFamilySquaresSession(session))?.id;
  if (typeof id === 'string' && ID_PATTERN.test(id) && id !== known) {
    known = id;
    void AsyncStorage.setItem(KEY, id).catch(() => undefined);
  }
  // Every other row in the list is known to be something else.
  const seen = sessions.flatMap((session) => (
    typeof session.id === 'string' && ID_PATTERN.test(session.id) && !isFamilySquaresSession(session) ? [session.id.toLowerCase()] : []
  ));
  if (!seen.length && !known) return;
  const add = () => {
    const next = new Set([...(others ?? []), ...seen].slice(-MAX_OTHERS));
    // The row that is Family Squares now is never also "something else".
    if (known) next.delete(known.toLowerCase());
    if (others && sameIds(others, next)) return;
    others = next;
    void AsyncStorage.setItem(OTHERS_KEY, JSON.stringify([...next])).catch(() => undefined);
  };
  // Added to what the device already has stored, never in place of it.
  if (others) add();
  else void knownOtherSessionIds().then(add);
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

/** The ids this device knows to be other sessions (lower case). Empty when it knows none. Never throws. */
export async function knownOtherSessionIds(): Promise<string[]> {
  if (!others) {
    let stored: string[] = [];
    try {
      const raw: unknown = JSON.parse((await AsyncStorage.getItem(OTHERS_KEY)) ?? '[]');
      if (Array.isArray(raw)) stored = raw.filter((id): id is string => typeof id === 'string' && ID_PATTERN.test(id)).map((id) => id.toLowerCase());
    } catch {
      // Unreadable: none known.
    }
    // Something loaded while this was reading wins.
    if (!others) others = new Set(stored.slice(-MAX_OTHERS));
  }
  return [...others];
}
