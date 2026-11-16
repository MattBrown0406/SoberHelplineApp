import { familySquaresSyncWindow, pacificDate } from '../../supabase/functions/_shared/family-squares-time';

/**
 * The Boundaries tab's challenge card has one special line: "It's Monday —
 * join the Family Squares Zoom meeting tonight at 7:00 PM Pacific". It must be
 * true when it shows:
 * - "meeting day" is the meeting's own Pacific date, not the phone's Monday
 *   (a phone in Sydney reaches Monday a day before the meeting);
 * - never in a week the website cancelled, and never after she said "can't
 *   make it this week".
 * Fail open: when the cancelled check or her answer could not be read, the
 * line shows as it always did.
 *
 * Spanish-language members see La Sobremesa's own line, which none of this
 * touches: it shows on the phone's Monday exactly as before.
 *
 * Pure (no device imports), so tests pin every case.
 */

/**
 * True on the Pacific day of the coming Family Squares meeting, until its
 * hour is over (after that the "coming" meeting is next Monday's, and
 * "tonight" would no longer be true).
 */
export function isFamilySquaresMeetingDay(now: Date = new Date()): boolean {
  return pacificDate(now) === familySquaresSyncWindow(now).meetingDate;
}

export function mondayChallengeShown(input: {
  /** The app is in Spanish: the line is La Sobremesa's. */
  spanish: boolean;
  /** The phone's own weekday is Monday. */
  localMonday: boolean;
  /** isFamilySquaresMeetingDay: tonight's Family Squares has not ended. */
  meetingDay: boolean;
  /** The coming meeting is known cancelled. */
  cancelled: boolean;
  /** She answered "can't make it" for the coming meeting. */
  declined: boolean;
}): boolean {
  if (input.spanish) return input.localMonday;
  return input.meetingDay && !input.cancelled && !input.declined;
}
