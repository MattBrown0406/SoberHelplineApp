import AsyncStorage from '@react-native-async-storage/async-storage';
import { logFunnelEvent } from './funnel';
import { captureAppError } from './monitoring';
import { attendanceDecision, newJoinMark, parseJoinMark, type JoinSource } from './familySquaresJoin';
import { markFamilySquaresJoined } from './familySquaresFirstTimer';

// Both keys carry the account id, so sign-out and account deletion clear them
// with the rest of that account's device data (accountLocalKeys).
const JOIN_KEY_PREFIX = '@sh:family-squares-join:';
const LOGGED_KEY_PREFIX = '@sh:family-squares-attended:';

function key(prefix: string, accountId: string): string {
  return `${prefix}${encodeURIComponent(accountId)}`;
}

/**
 * Call just before a Family Squares Join opens Zoom (Today, Support, or a
 * reminder push). At meeting time it leaves a mark for
 * flushFamilySquaresAttendance; at any other time of the week it only notes
 * that she has used Join. Never throws: it must not get in the way of joining.
 */
export async function markFamilySquaresJoin(accountId: string | null | undefined, source: JoinSource): Promise<void> {
  if (!accountId) return;
  try {
    const mark = newJoinMark(source);
    if (mark) await AsyncStorage.setItem(key(JOIN_KEY_PREFIX, accountId), JSON.stringify(mark));
    // She has found her way in once: the first-timer note has done its job.
    await markFamilySquaresJoined(accountId);
  } catch (error) {
    captureAppError(error);
  }
}

/** Zoom did not open after all: the tap was not a join. */
export async function clearFamilySquaresJoin(accountId: string | null | undefined): Promise<void> {
  if (!accountId) return;
  try {
    await AsyncStorage.removeItem(key(JOIN_KEY_PREFIX, accountId));
  } catch (error) {
    captureAppError(error);
  }
}

/**
 * Called whenever the app is in front again. Logs `attended_10min` once per
 * meeting when she comes back ten minutes or more after tapping Join; a quick
 * return or a stale mark logs nothing. Returns true when it logged.
 */
export async function flushFamilySquaresAttendance(accountId: string | null | undefined, nowMs = Date.now()): Promise<boolean> {
  if (!accountId) return false;
  const joinKey = key(JOIN_KEY_PREFIX, accountId);
  const loggedKey = key(LOGGED_KEY_PREFIX, accountId);
  try {
    const raw = await AsyncStorage.getItem(joinKey);
    if (!raw) return false;
    const mark = parseJoinMark(raw);
    if (!mark) {
      await AsyncStorage.removeItem(joinKey);
      return false;
    }
    const decision = attendanceDecision(mark, nowMs, await AsyncStorage.getItem(loggedKey));
    if (decision === 'keep') return false;
    await AsyncStorage.removeItem(joinKey);
    if (decision !== 'log') return false;
    // Remember before logging: a second return must never log the meeting twice
    // (the server also keeps one per member and meeting).
    await AsyncStorage.setItem(loggedKey, mark.meetingDate);
    logFunnelEvent('attended_10min', { meeting_date: mark.meetingDate, source: mark.source });
    return true;
  } catch (error) {
    captureAppError(error);
    return false;
  }
}
