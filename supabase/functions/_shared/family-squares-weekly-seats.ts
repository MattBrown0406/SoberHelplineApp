// "Save my seat every Monday": who gets a seat this run, who is left alone for
// a while, and when the run stops. Pure decisions; every read, write and
// website call is handed in, so the rules can be tested without a database or
// a network. family-squares-web-sync supplies the real ones.
//
// The rules:
// - A Monday known to be cancelled: nobody is asked.
// - The website says yes, or has no objection (see website-bridge.ts): her
//   seat is saved.
// - The website says that Monday is cancelled: it is noted for every Family
//   Squares push, and the run stops.
// - The website will not register her: remembered for that meeting.
// - An answer that makes no sense for her (an error status, a malformed
//   reply): nothing is written, she is left alone for about six hours, and the
//   next member is asked.
// - The website cannot be reached at all (network failure, timeout, 404):
//   the run stops, nothing is remembered, and everyone is tried again next run.
//
// Never log an email here: summaries are counts only.

import { type EnsureRegistrationOutcome, normalizeEmail } from './website-bridge.ts';

/** The longest one website call may take. */
export const SEAT_CALL_TIMEOUT_MS = 8_000;
/** With less than this left, nobody else is asked this run. */
export const MIN_TIME_TO_ASK_MS = 2_000;

/** Why a member is not asked again for a while (family_squares_weekly_seat_holds.reason). */
export type WeeklySeatHoldReason = 'meeting_cancelled' | 'registration_unavailable' | 'no_answer';

export type WeeklySeatSummary = {
  /** Website calls made this run: at most one per member. */
  asked: number;
  /** Seats written. */
  saved: number;
  /** Answers of "no objection" (the website could not write its own row). */
  no_objection: number;
  /** The website will not register her; not asked again for this meeting. */
  refused: number;
  /** No usable answer for her; not asked again for about six hours. */
  held: number;
  /** Why the run ended before everyone was asked, if it did. */
  stopped: 'meeting_cancelled' | 'website_unavailable' | 'lookup_failed' | 'out_of_time' | null;
};

export interface WeeklySeatDeps {
  /** True when that Monday is already known to be cancelled. A failed lookup answers false. */
  meetingCancelled(): Promise<boolean>;
  /** service_family_squares_weekly_seat_candidates rows, or null when the lookup failed. */
  candidates(): Promise<unknown[] | null>;
  /** Milliseconds left of this run's budget. */
  timeLeftMs(): number;
  /** False once the meeting has ended: a seat would be for the wrong Monday. */
  sameMeeting(): boolean;
  /** Asks the website about one member. Never throws. */
  ask(member: { email: string; name: string }, timeoutMs: number): Promise<EnsureRegistrationOutcome>;
  /** Writes her seat; true when a row was added. */
  save(accountId: string): Promise<boolean>;
  /** Remembers why she is not asked again for a while. */
  hold(accountId: string, reason: WeeklySeatHoldReason): Promise<void>;
  /** Records that the website said this Monday is cancelled. */
  noteCancelled(): Promise<void>;
}

export async function saveWeeklySeats(deps: WeeklySeatDeps): Promise<WeeklySeatSummary> {
  const summary: WeeklySeatSummary = { asked: 0, saved: 0, no_objection: 0, refused: 0, held: 0, stopped: null };
  // Already known: no seat is saved, and the website need not be asked.
  if (await deps.meetingCancelled()) return { ...summary, stopped: 'meeting_cancelled' };
  const rows = await deps.candidates();
  if (!Array.isArray(rows)) return { ...summary, stopped: 'lookup_failed' };

  const asked = new Set<string>();
  for (const raw of rows) {
    const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const accountId = typeof row.account_id === 'string' ? row.account_id : null;
    const email = normalizeEmail(row.email);
    if (!accountId || !email || asked.has(accountId)) continue;
    const timeLeft = deps.timeLeftMs();
    if (timeLeft < MIN_TIME_TO_ASK_MS || !deps.sameMeeting()) return { ...summary, stopped: 'out_of_time' };
    asked.add(accountId);
    summary.asked += 1;
    const answer = await deps.ask(
      { email, name: typeof row.name === 'string' && row.name.trim() ? row.name.trim() : 'Family' },
      Math.min(SEAT_CALL_TIMEOUT_MS, timeLeft),
    );
    switch (answer.outcome) {
      case 'registered':
      case 'no_objection':
        if (answer.outcome === 'no_objection') summary.no_objection += 1;
        // The row is only ever added: an answer she gave meanwhile stands.
        if (await deps.save(accountId)) summary.saved += 1;
        break;
      case 'meeting_cancelled':
        // Cancelled for everyone: nobody else is asked, and no push announces it.
        await deps.noteCancelled();
        await deps.hold(accountId, 'meeting_cancelled');
        return { ...summary, stopped: 'meeting_cancelled' };
      case 'registration_unavailable':
        await deps.hold(accountId, 'registration_unavailable');
        summary.refused += 1;
        break;
      default:
        // The website answered, but not sensibly, for her: a problem with this
        // one member must not hold up the rest, or be asked about every run.
        if (answer.reason === 'unexpected_reply') {
          await deps.hold(accountId, 'no_answer');
          summary.held += 1;
          break;
        }
        // Not deployed or unreachable: the same for everyone. Nothing is
        // written; every member is asked about again next run.
        return { ...summary, stopped: 'website_unavailable' };
    }
  }
  return summary;
}
