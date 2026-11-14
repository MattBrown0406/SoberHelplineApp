import { Linking } from 'react-native';
import { supabase } from './supabase';
import { logFunnelEventAndWait } from './funnel';
import { withAppContext } from './websiteLinks';
import { withTimeoutFallback } from './authBootstrap';
import {
  familySquaresReminderTapPlan,
  reminderLookupFallback,
  reminderSessionKnowledge,
  type ReminderTapPlan,
} from './familySquaresJoin';
import { knownFamilySquaresSessionId, rememberFamilySquaresSession } from './familySquaresSessionCache';
import { clearFamilySquaresJoin, markFamilySquaresJoin } from './meetingAttendance';

// Family Squares reminders say "tap to join", so the tap should join. The
// decisions are in familySquaresJoin (no device APIs, so they can be tested);
// this file does the looking up and the opening.
export { reminderJoinSessionId } from './familySquaresJoin';

/**
 * A tap must never wait long on a slow network. Only a reminder that is (or
 * may be) about Family Squares looks anything up, and for this long at most.
 */
export const LOOKUP_TIMEOUT_MS = 1_500;
/** Reading the remembered session id is local and quick; this is only a backstop. */
const KNOWN_ID_TIMEOUT_MS = 300;

/**
 * What the tap does. A reminder for any other session (La Sobremesa, a group)
 * answers at once, with no network: it opens what it always opened. A Family
 * Squares reminder looks its link up for up to a second and a half, then falls
 * back to Today's call card.
 */
export async function planReminderJoin(sessionId: string): Promise<ReminderTapPlan> {
  const knownId = await withTimeoutFallback(knownFamilySquaresSessionId(), KNOWN_ID_TIMEOUT_MS, null);
  const knowledge = reminderSessionKnowledge(sessionId, knownId);
  if (knowledge === 'other') return { action: 'default' };
  const fallback = reminderLookupFallback(knowledge);
  return withTimeoutFallback(lookUpPlan(sessionId, fallback), LOOKUP_TIMEOUT_MS, fallback);
}

async function lookUpPlan(sessionId: string, fallback: ReminderTapPlan): Promise<ReminderTapPlan> {
  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('title, zoom_url')
      .eq('id', sessionId)
      .maybeSingle();
    // A failed lookup: the call card for Family Squares, else the push's usual destination.
    if (error || !data) return fallback;
    const session = data as { title?: string | null; zoom_url?: string | null };
    // Next time this device knows without asking.
    rememberFamilySquaresSession([{ id: sessionId, title: session.title }]);
    return familySquaresReminderTapPlan(session);
  } catch {
    return fallback;
  }
}

/**
 * Opens the meeting from a reminder tap and logs the Join exactly as the Join
 * buttons do. If Zoom does not open she is already on Today's call card (the
 * caller navigated there first), so nothing more is needed.
 */
export async function joinFamilySquaresFromPush(accountId: string, url: string): Promise<boolean> {
  // Noted before Zoom opens, so coming back ten minutes later can count as attending.
  await markFamilySquaresJoin(accountId, 'push');
  // Sent before Zoom opens too: once the app is in the background the request
  // may never leave. Waits a moment at most (funnel).
  await logFunnelEventAndWait('attended', { source: 'push' });
  try {
    await Linking.openURL(withAppContext(url));
    return true;
  } catch {
    await clearFamilySquaresJoin(accountId);
    return false;
  }
}
