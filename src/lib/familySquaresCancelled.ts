import { supabase } from './supabase';
import { familySquaresSyncWindow } from '../../supabase/functions/_shared/family-squares-time';

/**
 * A Monday the website cancelled.
 *
 * soberhelpline.com can cancel a Family Squares meeting; the server mirrors
 * that and answers `family_squares_meeting_cancelled(date)` for signed-in
 * members. The date is the coming meeting's date in Pacific time, the same
 * date an RSVP is kept for (familySquaresRsvpIsCurrent).
 *
 * FAIL OPEN, always: an error, a server without the function yet, or anything
 * but a plain `true` means "not cancelled". A member must never be told a
 * meeting is off on a guess.
 */

/** The coming meeting's Pacific date (YYYY-MM-DD): tonight's until its hour is over. */
export function comingFamilySquaresMeetingDate(now: Date = new Date()): string {
  return familySquaresSyncWindow(now).meetingDate;
}

/** Reads the server's answer. Only a clean boolean `true` is "cancelled". */
export function meetingCancelledFrom(result: { data?: unknown; error?: unknown } | null | undefined): boolean {
  return !!result && !result.error && result.data === true;
}

/**
 * A cancelled week is always kept as WHICH meeting date was cancelled, never
 * as a bare yes: the answer for one Monday must not be shown for the next. Ask
 * this every time a card is drawn or the answer is used; a date that is not
 * the coming meeting's (last week's, or none) is "not cancelled".
 */
export function isCancelledMeetingDate(cancelledDate: unknown, now: Date = new Date()): boolean {
  return typeof cancelledDate === 'string' && cancelledDate !== '' && cancelledDate === comingFamilySquaresMeetingDate(now);
}

// The last answer, for this run of the app: lets a failed seat save and a
// reminder tap say the right thing without asking again.
let knownCancelledDate: string | null = null;

/** True when the coming meeting was cancelled the last time the server was asked. */
export function isFamilySquaresKnownCancelled(now: Date = new Date()): boolean {
  return isCancelledMeetingDate(knownCancelledDate, now);
}

/**
 * The website itself just refused a seat because the coming meeting is
 * cancelled (family-squares-register's `reason: 'meeting_cancelled'`): that is
 * a clean answer, so the date is remembered on the device. Returns the date.
 */
export function markFamilySquaresCancelled(now: Date = new Date()): string {
  knownCancelledDate = comingFamilySquaresMeetingDate(now);
  return knownCancelledDate;
}

/**
 * The coming meeting's date when the website cancelled it, else null. Never
 * throws; any doubt is null ("not cancelled").
 */
export async function loadFamilySquaresCancelledDate(now: Date = new Date()): Promise<string | null> {
  const meetingDate = comingFamilySquaresMeetingDate(now);
  let cancelled = false;
  try {
    cancelled = meetingCancelledFrom(await supabase.rpc('family_squares_meeting_cancelled', { p_meeting_date: meetingDate }));
  } catch {
    cancelled = false;
  }
  if (cancelled) knownCancelledDate = meetingDate;
  else if (knownCancelledDate === meetingDate) knownCancelledDate = null;
  return cancelled ? meetingDate : null;
}

/** Whether the coming meeting is cancelled. Never throws; any doubt is "no". */
export async function loadFamilySquaresCancelled(now: Date = new Date()): Promise<boolean> {
  return (await loadFamilySquaresCancelledDate(now)) !== null;
}
