/**
 * What the Family Squares call card and its Support entry show.
 *
 * The website can cancel a Monday. On a cancelled week nothing on the card may
 * suggest the meeting is on: no Save my spot, no Join, no "can't make it", no
 * first-timer note, no reminder ask and no question for the call. Only a calm
 * line, and the "every Monday" switch (which is about the weeks after).
 *
 * Pure (no imports at all), so tests pin every case.
 */

/** Her answer for the coming meeting. */
export type SeatAnswer = 'going' | 'declined' | 'none';

/**
 * Where the clock is against the meeting's join window: from three hours
 * before its start until it ends. 'unknown' when the start cannot be read.
 */
export type JoinWindow = 'inside' | 'outside' | 'unknown';

/** Which of the card's two actions is the big button; the other is a small link under it. */
export type Prominence = 'main' | 'quiet';

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
  /** sessionJoinWindow. Left out, it is 'unknown': a set link leads, as it always did. */
  joinWindow?: JoinWindow;
}

export interface CallCardView {
  /** "There's no Family Squares this Monday. It's back next week." */
  cancelledLine: boolean;
  /** The Join button. Anyone may join once the link is set: an RSVP is never a gate. */
  join: boolean;
  /**
   * Days before the meeting, Join opens an empty room: it is the small link.
   * Inside the join window (or when the start is not known) it is the big button.
   */
  joinProminence: Prominence;
  /** "Save my spot": the big button until the join window opens, then the small link under Join. */
  saveSpot: boolean;
  saveProminence: Prominence;
  /** "Your spot is saved for Monday, November 16": the one confirmation, with or without a link. */
  confirmed: boolean;
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
  const join = !cancelled && input.hasLink;
  const saveSpot = !cancelled && !going;
  // What each tap does never changes here, only which one is the big button.
  const joinLeads = join && (input.joinWindow ?? 'unknown') !== 'outside';
  return {
    cancelledLine: cancelled,
    join,
    joinProminence: joinLeads ? 'main' : 'quiet',
    saveSpot,
    saveProminence: saveSpot && !joinLeads ? 'main' : 'quiet',
    confirmed: !cancelled && going,
    question: !cancelled && input.familySquares && going,
    rsvpNote: !cancelled && input.familySquares,
    firstTimerNote: !cancelled && input.familySquares,
  };
}

/** Join becomes the big button this long before the meeting starts. */
export const JOIN_WINDOW_LEAD_MS = 3 * 60 * 60_000;
/** A call runs for an hour. La Sobremesa's callers pass its own length (LA_SOBREMESA_CALL_LENGTH_MS). */
const CALL_LENGTH_MS = 60 * 60_000;

/** `sessions.next_at` as a time, or null. Reads what familySquaresSchedule reads (ISO or Postgres text). */
function meetingStartMs(nextAt: string | null | undefined): number | null {
  if (!nextAt) return null;
  const start = Date.parse(nextAt
    .trim()
    .replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/, '$1T$2')
    .replace(/([+-]\d{2})$/, '$1:00'));
  return Number.isFinite(start) ? start : null;
}

/**
 * Whether the meeting is close enough for Join to be the big button: from
 * three hours before its start (`next_at`) until it ends. A start that is
 * missing or unreadable is 'unknown', never a guess.
 */
export function sessionJoinWindow(
  nextAt: string | null | undefined,
  now: Date = new Date(),
  lengthMs: number = CALL_LENGTH_MS,
): JoinWindow {
  const start = meetingStartMs(nextAt);
  if (start === null) return 'unknown';
  const at = now.getTime();
  // Past its end: `next_at` has not been moved on (or the call is running
  // over). That is not "days before the meeting", so Join leads as it always did.
  if (at >= start + lengthMs) return 'unknown';
  return start - JOIN_WINDOW_LEAD_MS <= at ? 'inside' : 'outside';
}

/**
 * The meeting's day for "Your spot is saved for …" ("Monday, November 16",
 * "lunes, 16 de noviembre"), in the member's own time zone like the time on
 * the card. Null when the start is unknown or the meeting is over: the line
 * is then said without a date, never with a wrong one.
 */
export function meetingDayLabel(
  nextAt: string | null | undefined,
  options: { now?: Date; locale?: string; timeZone?: string; lengthMs?: number } = {},
): string | null {
  const start = meetingStartMs(nextAt);
  if (start === null || start + (options.lengthMs ?? CALL_LENGTH_MS) <= (options.now ?? new Date()).getTime()) return null;
  try {
    return new Intl.DateTimeFormat(options.locale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      ...(options.timeZone ? { timeZone: options.timeZone } : {}),
    }).format(new Date(start));
  } catch {
    return null;
  }
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
 * - 'weekly_only' — the switch and nothing else: the week is cancelled, or
 *                   her switch is on but "your seat is saved for you" cannot
 *                   be said to her (`weeklyNoteHeld`).
 */
export type SeatPanelView = 'hidden' | 'weekly_note' | 'full' | 'declined' | 'weekly_only';

export function seatPanelView(input: {
  cancelled: boolean;
  answer: SeatAnswer;
  weeklySeatOn: boolean;
  /** The weekly note would not be true for her (weeklySeatNoteHeld). */
  weeklyNoteHeld?: boolean;
}): SeatPanelView {
  if (input.cancelled) return 'weekly_only';
  if (input.answer === 'going') return 'full';
  if (input.answer === 'declined') return 'declined';
  if (!input.weeklySeatOn) return 'hidden';
  return input.weeklyNoteHeld ? 'weekly_only' : 'weekly_note';
}

/**
 * Whether "your seat is saved for you" must NOT be said. The server saves no
 * weekly seat for a bereaved member who paused her reminders, nor for one the
 * website would not register this week, so the sentence is held back when:
 * - the device does not know she is NOT bereaved. It keeps no copy that says
 *   "bereaved, and reminders are on", so every bereaved member, and anyone
 *   the device has no answer for yet, sees the switch without the sentence;
 * - a Save tap on this device was refused by the website for the coming
 *   meeting (familySquaresSeatRefusedHere).
 */
export function weeklySeatNoteHeld(input: { bereaved: boolean | undefined; refusedHere: boolean }): boolean {
  return input.bereaved !== false || input.refusedHere;
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
