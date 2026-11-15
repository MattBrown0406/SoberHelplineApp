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
  /** The website cancelled the coming Monday's meeting. Only ever true for Family Squares. */
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
 * The words for a seat that was not saved. The website refusing (a cancelled
 * week, or an attendee it will not register) is not a connection problem, so
 * it never says "check your connection": the cancelled line when the week is
 * known cancelled, otherwise that registration is not available right now.
 */
export function seatSaveFailureKey(failure: SeatSaveFailure | undefined, cancelled: boolean): string {
  if (failure !== 'website_declined') return 'support:sessions.rsvpErrorBody';
  return cancelled ? 'common:familySquares.cancelled.line' : 'common:familySquares.registrationUnavailable';
}
