import { supabase } from './supabase';
import { familySquaresRsvpIsCurrent, reserveFamilySquares } from './familySquaresRegistration';

/**
 * Two things a member can tell us about her Family Squares seat:
 * - "Save my seat every Monday" (accounts.family_squares_weekly_seat): the
 *   Tuesday reset saves next Monday's seat for her, so she does not have to.
 * - "Can't make it this week": her RSVP becomes "declined" for this meeting
 *   only. Saving her spot again turns it back.
 */

type Listener = (accountId: string, enabled: boolean) => void;
const listeners = new Set<Listener>();

/** Her saved preference, or null when it could not be read (offline, older backend). */
export async function loadWeeklySeat(accountId: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase
      .from('accounts')
      .select('family_squares_weekly_seat')
      .eq('id', accountId)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { family_squares_weekly_seat?: unknown }).family_squares_weekly_seat === true;
  } catch {
    return null;
  }
}

/** True when the server saved it. Every screen showing the switch hears the new value. */
export async function saveWeeklySeat(accountId: string, enabled: boolean): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('set_family_squares_weekly_seat', { p_enabled: enabled });
    if (error) return false;
  } catch {
    return false;
  }
  for (const listener of [...listeners]) {
    try {
      listener(accountId, enabled);
    } catch {
      // One screen failing must not stop the others.
    }
  }
  return true;
}

/** Today, Support and Settings can all be mounted at once: keep their switches in step. */
export function subscribeWeeklySeat(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True when her saved seat is now "can't make it" (false: nothing saved, or the change failed). */
export async function declineFamilySquares(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('decline_family_squares_rsvp');
    return !error && data === true;
  } catch {
    return false;
  }
}

/**
 * Turning "every Monday" on in Settings should cover the coming meeting too,
 * not only the ones after the next Tuesday reset. Saves her seat unless she
 * has already answered for that meeting ("can't make it" stays as she left
 * it). Best effort: the weekly preference itself is already saved.
 */
export async function saveComingSeatIfUnanswered(accountId: string): Promise<void> {
  try {
    const { data: sessionId, error: sessionError } = await supabase.rpc('family_squares_session_id');
    if (sessionError || typeof sessionId !== 'string' || !sessionId) return;
    const { data: answer, error } = await supabase
      .from('session_rsvps')
      .select('family_squares_meeting_date')
      .eq('session_id', sessionId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (error || familySquaresRsvpIsCurrent(answer?.family_squares_meeting_date)) return;
    await reserveFamilySquares(accountId);
  } catch {
    // The Tuesday reset saves her seat from next week on either way.
  }
}
