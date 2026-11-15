/**
 * What the Family Squares call card and its Support entry show.
 *
 * The website can cancel a Monday. On a cancelled week nothing on the card may
 * suggest the meeting is on: no Save my spot, no Join, no "can't make it", no
 * first-timer note, no reminder ask and no question for the call. Only a calm
 * line, and the "every Monday" switch (which is about the weeks after).
 *
 * Pure (no device imports), so tests pin every case.
 */

/** Her answer for the coming meeting. */
export type SeatAnswer = 'going' | 'declined' | 'none';

export interface CallCardInput {
  /** The call is Family Squares (not La Sobremesa or another group call). */
  familySquares: boolean;
  /**
   * The website cancelled the COMING Monday's meeting (the caller compares the
   * cancelled date with the coming meeting's date each time it draws the card:
   * isCancelledMeetingDate). Only ever true for Family Squares.
   */
  cancelled: boolean;
  answer: SeatAnswer;
  /** The meeting's link is set. */
  hasLink: boolean;
}

export interface CallCardView {
  /** "There's no Family Squares this Monday. It's back next week." */
  cancelledLine: boolean;
  /** The Join button. Anyone may join once the link is set: an RSVP is never a gate. */
  join: boolean;
  /** "Save my spot" (the main button without a link, a smaller link beside Join). */
  saveSpot: boolean;
  /** "You're going" in place of the main button, when there is no link to join yet. */
  going: boolean;
  /** "Send a question for the call". */
  question: boolean;
  /** Where her RSVP and questions go. */
  rsvpNote: boolean;
  /** "What to expect your first time". */
  firstTimerNote: boolean;
}

export function callCardView(input: CallCardInput): CallCardView {
  // Fail open: only a Family Squares meeting that is known cancelled changes anything.
  const cancelled = input.familySquares && input.cancelled;
  const going = input.answer === 'going';
  return {
    cancelledLine: cancelled,
    join: !cancelled && input.hasLink,
    saveSpot: !cancelled && !going,
    going: !cancelled && going && !input.hasLink,
    question: !cancelled && input.familySquares && going,
    rsvpNote: !cancelled && input.familySquares,
    firstTimerNote: !cancelled && input.familySquares,
  };
}

/** "What to expect your first time" is for accounts no older than this. */
export const FIRST_TIMER_NOTE_DAYS = 30;

/**
 * Whether an account is new enough for "What to expect your first time".
 * The note's own signal lives on the device (hidden once she dismisses it or
 * first taps Join), so someone who has come for months but has a new phone or
 * a freshly updated app would look like a first-timer. Only an account
 * created in the last 30 days can be shown it. An unknown or unreadable date
 * hides it: never on a guess.
 */
export function accountIsNewForFirstTimerNote(joinedAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!joinedAt) return false;
  const ageMs = now.getTime() - Date.parse(joinedAt);
  return Number.isFinite(ageMs) && ageMs < FIRST_TIMER_NOTE_DAYS * 86_400_000;
}

/**
 * What the panel under the Family Squares card shows:
 * - 'hidden'      — no seat and no weekly seat: nothing yet.
 * - 'weekly_note' — no seat for the coming Monday, but her "every Monday"
 *                   switch is on (after Monday's meeting, until her seat is
 *                   saved for her): say so, with the switch. She can still
 *                   save her spot now with the card's own button.
 * - 'full'        — her seat is saved: the reminder ask, the switch, the
 *                   calendar file and "can't make it this week".
 * - 'declined'    — she is sitting this week out.
 * - 'weekly_only' — the week is cancelled: the switch and nothing else.
 */
export type SeatPanelView = 'hidden' | 'weekly_note' | 'full' | 'declined' | 'weekly_only';

export function seatPanelView(input: { cancelled: boolean; answer: SeatAnswer; weeklySeatOn: boolean }): SeatPanelView {
  if (input.cancelled) return 'weekly_only';
  if (input.answer === 'going') return 'full';
  if (input.answer === 'declined') return 'declined';
  return input.weeklySeatOn ? 'weekly_note' : 'hidden';
}

/** Why saving a Family Squares seat did not work, as far as the app can tell. */
export type SeatSaveFailure = 'website_declined' | 'failed';

/**
 * Why the website refused, when it says (family-squares-register's `reason`;
 * older servers send none): the coming meeting is cancelled, or it will not
 * register this attendee right now.
 */
export type WebsiteDeclineReason = 'meeting_cancelled' | 'registration_unavailable';

/** Reads the server's `reason`. Anything it does not know is "not said". */
export function websiteDeclineReason(value: unknown): WebsiteDeclineReason | undefined {
  return value === 'meeting_cancelled' || value === 'registration_unavailable' ? value : undefined;
}

/**
 * The words for a seat that was not saved. The website refusing (a cancelled
 * week, or an attendee it will not register) is not a connection problem, so
 * it never says "check your connection". When the website says why, its word
 * decides: the cancelled line, or that registration is not available right
 * now. When it does not (an older server), the cancelled line is used only if
 * the week is known cancelled.
 */
export function seatSaveFailureKey(failure: SeatSaveFailure | undefined, cancelled: boolean, websiteReason?: WebsiteDeclineReason): string {
  if (failure !== 'website_declined') return 'support:sessions.rsvpErrorBody';
  if (websiteReason === 'meeting_cancelled') return 'common:familySquares.cancelled.line';
  if (websiteReason === 'registration_unavailable') return 'common:familySquares.registrationUnavailable';
  return cancelled ? 'common:familySquares.cancelled.line' : 'common:familySquares.registrationUnavailable';
}
