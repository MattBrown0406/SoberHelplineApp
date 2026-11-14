import { Linking } from 'react-native';
import { supabase } from './supabase';
import { logFunnelEvent } from './funnel';
import { withAppContext } from './websiteLinks';
import { withTimeoutFallback } from './authBootstrap';
import { familySquaresReminderTapPlan, type ReminderTapPlan } from './familySquaresJoin';
import { clearFamilySquaresJoin, markFamilySquaresJoin } from './meetingAttendance';

// Family Squares reminders say "tap to join", so the tap should join. The
// decisions are in familySquaresJoin (no device APIs, so they can be tested);
// this file does the looking up and the opening.
export { reminderJoinSessionId } from './familySquaresJoin';

/** A tap must never wait on a slow network: after this the push opens what it always opened. */
const LOOKUP_TIMEOUT_MS = 4_000;

/** Looks up the session the reminder names. Any failure keeps the push's usual destination. */
export function planReminderJoin(sessionId: string): Promise<ReminderTapPlan> {
  return withTimeoutFallback(lookUpPlan(sessionId), LOOKUP_TIMEOUT_MS, { action: 'default' });
}

async function lookUpPlan(sessionId: string): Promise<ReminderTapPlan> {
  const { data, error } = await supabase
    .from('sessions')
    .select('title, zoom_url')
    .eq('id', sessionId)
    .maybeSingle();
  if (error || !data) return { action: 'default' };
  return familySquaresReminderTapPlan(data as { title?: string | null; zoom_url?: string | null });
}

/**
 * Opens the meeting from a reminder tap and logs the Join exactly as the Join
 * buttons do. If Zoom does not open she is already on Today's call card (the
 * caller navigated there first), so nothing more is needed.
 */
export async function joinFamilySquaresFromPush(accountId: string, url: string): Promise<boolean> {
  // Noted before Zoom opens, so coming back ten minutes later can count as attending.
  await markFamilySquaresJoin(accountId, 'push');
  try {
    await Linking.openURL(withAppContext(url));
    logFunnelEvent('attended', { source: 'push' });
    return true;
  } catch {
    await clearFamilySquaresJoin(accountId);
    return false;
  }
}
