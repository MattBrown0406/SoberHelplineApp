import AsyncStorage from '@react-native-async-storage/async-storage';
import { logFunnelEventConfirmed } from './funnel';
import { captureAppError } from './monitoring';
import { withTimeoutFallback } from './authBootstrap';
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

// One flush per account at a time: a second return while the first is still
// being sent must not send the meeting twice.
const flushing = new Map<string, Promise<boolean>>();
/** A send with no answer after this long counts as not sent: the next return tries again. */
export const ATTENDANCE_SEND_WAIT_MS = 15_000;

/**
 * Called whenever the app is in front again. Logs `attended_10min` once per
 * meeting when she is back after the meeting has been going ten minutes and
 * ten minutes or more after tapping Join. An earlier return keeps the mark for
 * her next one; a mark from an evening that is over logs nothing. Returns true
 * when it logged.
 *
 * The meeting is marked as logged only AFTER the server has taken the event.
 * If the send fails (she walks back in with no signal), the Join mark stays
 * and the next return tries again, until the mark's own expiry
 * (attendanceDecision). Marking first lost her attendance for good.
 */
export function flushFamilySquaresAttendance(accountId: string | null | undefined, nowMs = Date.now()): Promise<boolean> {
  if (!accountId) return Promise.resolve(false);
  const running = flushing.get(accountId);
  if (running) return running;
  const flush = flushAttendance(accountId, nowMs).finally(() => flushing.delete(accountId));
  flushing.set(accountId, flush);
  return flush;
}

async function flushAttendance(accountId: string, nowMs: number): Promise<boolean> {
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
    if (decision !== 'log') {
      await AsyncStorage.removeItem(joinKey);
      return false;
    }
    // Sent first, and waited for. Not taken: the mark stays for the next return.
    // (Two sends of one meeting are harmless: the server keeps one per member and meeting.)
    const logged = await withTimeoutFallback(
      logFunnelEventConfirmed('attended_10min', { meeting_date: mark.meetingDate, source: mark.source }),
      ATTENDANCE_SEND_WAIT_MS,
      false,
    );
    if (!logged) return false;
    // Taken: remember it, so a later return never logs the meeting again.
    await AsyncStorage.setItem(loggedKey, mark.meetingDate);
    await AsyncStorage.removeItem(joinKey);
    return true;
  } catch (error) {
    captureAppError(error);
    return false;
  }
}
