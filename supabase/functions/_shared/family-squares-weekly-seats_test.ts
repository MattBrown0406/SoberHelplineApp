import {
  MIN_TIME_TO_ASK_MS,
  saveWeeklySeats,
  SEAT_CALL_TIMEOUT_MS,
  type WeeklySeatDeps,
  type WeeklySeatHoldReason,
} from './family-squares-weekly-seats.ts';
import type { EnsureRegistrationOutcome } from './website-bridge.ts';

function assertEquals(actual: unknown, expected: unknown, message = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message} expected ${e}, got ${a}`);
}

const YES: EnsureRegistrationOutcome = { outcome: 'registered', alreadyRegistered: false };
const NO_OBJECTION: EnsureRegistrationOutcome = { outcome: 'no_objection' };
const CANCELLED: EnsureRegistrationOutcome = { outcome: 'meeting_cancelled' };
const REFUSED: EnsureRegistrationOutcome = { outcome: 'registration_unavailable' };
const NONSENSE: EnsureRegistrationOutcome = { outcome: 'unavailable', reason: 'unexpected_reply' };
const TROUBLE: EnsureRegistrationOutcome = { outcome: 'unavailable', reason: 'website_error' };
const UNREACHABLE: EnsureRegistrationOutcome = { outcome: 'unavailable', reason: 'unreachable' };
const NOT_DEPLOYED: EnsureRegistrationOutcome = { outcome: 'unavailable', reason: 'not_deployed' };

const member = (letter: string) => ({ account_id: `account-${letter}`, email: `${letter}@example.com`, name: letter.toUpperCase() });

/** A run with synthetic members, website answers by email, and a record of everything done. */
function run(options: {
  rows?: unknown[] | null;
  answers?: Record<string, EnsureRegistrationOutcome>;
  cancelled?: boolean;
  /** This run's sync reply said the meeting is on (`cancelled: false`). */
  syncSaidOn?: boolean;
  /** Milliseconds left before each website call, in order; the last value repeats. */
  timeLeft?: number[];
  sameMeeting?: () => boolean;
  /** Accounts whose row is not added (she answered in the meantime). */
  notSaved?: string[];
}) {
  const log = {
    asked: [] as { email: string; name: string; timeoutMs: number }[],
    saved: [] as string[],
    held: [] as { accountId: string; reason: WeeklySeatHoldReason }[],
    notedCancelled: 0,
    lookedUp: 0,
  };
  const times = [...(options.timeLeft ?? [15_000])];
  const deps: WeeklySeatDeps = {
    syncSaidOn: options.syncSaidOn === true,
    meetingCancelled: () => Promise.resolve(options.cancelled === true),
    candidates: () => {
      log.lookedUp += 1;
      return Promise.resolve(options.rows === undefined ? [member('a'), member('b'), member('c')] : options.rows);
    },
    timeLeftMs: () => (times.length > 1 ? times.shift()! : times[0]),
    sameMeeting: options.sameMeeting ?? (() => true),
    ask: (who, timeoutMs) => {
      log.asked.push({ ...who, timeoutMs });
      return Promise.resolve(options.answers?.[who.email] ?? YES);
    },
    save: (accountId) => {
      log.saved.push(accountId);
      return Promise.resolve(!(options.notSaved ?? []).includes(accountId));
    },
    hold: (accountId, reason) => {
      log.held.push({ accountId, reason });
      return Promise.resolve();
    },
    noteCancelled: () => {
      log.notedCancelled += 1;
      return Promise.resolve();
    },
  };
  return saveWeeklySeats(deps).then((summary) => ({ summary, log }));
}

Deno.test('weekly seats: a yes saves her seat, and so does "no objection"', async () => {
  const { summary, log } = await run({ answers: { 'b@example.com': NO_OBJECTION } });
  assertEquals(log.saved, ['account-a', 'account-b', 'account-c']);
  assertEquals(summary, { asked: 3, saved: 3, no_objection: 1, refused: 0, held: 0, stopped: null });
  assertEquals(log.held, []);
  assertEquals(log.notedCancelled, 0);
  // The website is asked with the email and name the database gave, within the call limit.
  assertEquals(log.asked[0], { email: 'a@example.com', name: 'A', timeoutMs: SEAT_CALL_TIMEOUT_MS });
});

Deno.test('weekly seats: a seat she answered for in the meantime is not counted as saved', async () => {
  const { summary, log } = await run({ notSaved: ['account-b'] });
  assertEquals(log.saved, ['account-a', 'account-b', 'account-c']);
  assertEquals(summary.saved, 2);
  assertEquals(summary.asked, 3);
});

Deno.test('weekly seats: a network failure or timeout writes nothing and ends the run', async () => {
  const { summary, log } = await run({ answers: { 'a@example.com': UNREACHABLE } });
  assertEquals(summary, { asked: 1, saved: 0, no_objection: 0, refused: 0, held: 0, stopped: 'website_unavailable' });
  assertEquals(log.saved, []);
  // Nothing is remembered either: everyone is tried again next run.
  assertEquals(log.held, []);
  assertEquals(log.asked.length, 1);
});

Deno.test('weekly seats: a website that is not deployed (404) ends the run the same way', async () => {
  const { summary, log } = await run({ answers: { 'b@example.com': NOT_DEPLOYED } });
  assertEquals(summary, { asked: 2, saved: 1, no_objection: 0, refused: 0, held: 0, stopped: 'website_unavailable' });
  assertEquals(log.saved, ['account-a']);
  assertEquals(log.held, []);
});

Deno.test('weekly seats: a cancelled answer records the status, stops the run and saves nothing more', async () => {
  const { summary, log } = await run({ answers: { 'b@example.com': CANCELLED } });
  assertEquals(summary, { asked: 2, saved: 1, no_objection: 0, refused: 0, held: 0, stopped: 'meeting_cancelled' });
  assertEquals(log.notedCancelled, 1);
  assertEquals(log.held, [{ accountId: 'account-b', reason: 'meeting_cancelled' }]);
  // C is never asked: the Monday is cancelled for everyone.
  assertEquals(log.asked.map((a) => a.email), ['a@example.com', 'b@example.com']);
  assertEquals(log.saved, ['account-a']);
});

Deno.test('weekly seats: the sync reply is the authority: after it said "on", one member\'s "cancelled" only holds her', async () => {
  const { summary, log } = await run({ syncSaidOn: true, answers: { 'a@example.com': CANCELLED, 'b@example.com': CANCELLED } });
  // The Monday is not marked cancelled, so the status cannot flap between runs.
  assertEquals(log.notedCancelled, 0);
  // Each is left alone for six hours ("no_answer"), never held as "meeting_cancelled":
  // that reason stops everyone, and the next sync reply would clear it at once.
  assertEquals(log.held, [
    { accountId: 'account-a', reason: 'no_answer' },
    { accountId: 'account-b', reason: 'no_answer' },
  ]);
  // The run goes on: C is asked and her seat is saved.
  assertEquals(log.asked.map((a) => a.email), ['a@example.com', 'b@example.com', 'c@example.com']);
  assertEquals(log.saved, ['account-c']);
  assertEquals(summary, { asked: 3, saved: 1, no_objection: 0, refused: 0, held: 2, stopped: null });
});

Deno.test('weekly seats: when the sync reply did not say, one member\'s "cancelled" answer still marks the Monday', async () => {
  const { summary, log } = await run({ syncSaidOn: false, answers: { 'a@example.com': CANCELLED } });
  assertEquals(log.notedCancelled, 1);
  assertEquals(log.held, [{ accountId: 'account-a', reason: 'meeting_cancelled' }]);
  assertEquals(log.asked.length, 1);
  assertEquals(summary, { asked: 1, saved: 0, no_objection: 0, refused: 0, held: 0, stopped: 'meeting_cancelled' });
});

Deno.test('weekly seats: a website in trouble (5xx, 429, not JSON) stops the run and holds nobody', async () => {
  const { summary, log } = await run({ answers: { 'b@example.com': TROUBLE, 'c@example.com': TROUBLE } });
  assertEquals(summary, { asked: 2, saved: 1, no_objection: 0, refused: 0, held: 0, stopped: 'website_unavailable' });
  // Nothing is remembered about B, and C is not asked during the outage.
  assertEquals(log.held, []);
  assertEquals(log.asked.map((a) => a.email), ['a@example.com', 'b@example.com']);
  assertEquals(log.saved, ['account-a']);
  assertEquals(log.notedCancelled, 0);

  // The first answer is an error: one call, nothing written at all.
  const down = await run({ syncSaidOn: true, answers: { 'a@example.com': TROUBLE } });
  assertEquals(down.summary, { asked: 1, saved: 0, no_objection: 0, refused: 0, held: 0, stopped: 'website_unavailable' });
  assertEquals(down.log.held, []);
  assertEquals(down.log.saved, []);
});

Deno.test('weekly seats: a Monday already known to be cancelled means nobody is asked', async () => {
  const { summary, log } = await run({ cancelled: true });
  assertEquals(summary, { asked: 0, saved: 0, no_objection: 0, refused: 0, held: 0, stopped: 'meeting_cancelled' });
  assertEquals(log.lookedUp, 0);
  assertEquals(log.asked, []);
  assertEquals(log.saved, []);
  assertEquals(log.held, []);
  assertEquals(log.notedCancelled, 0);
});

Deno.test('weekly seats: a member the website refuses is remembered, and the others are still asked', async () => {
  const { summary, log } = await run({ answers: { 'a@example.com': REFUSED } });
  assertEquals(summary, { asked: 3, saved: 2, no_objection: 0, refused: 1, held: 0, stopped: null });
  assertEquals(log.held, [{ accountId: 'account-a', reason: 'registration_unavailable' }]);
  assertEquals(log.saved, ['account-b', 'account-c']);
});

Deno.test('weekly seats: a 4xx reply about one member holds her and continues', async () => {
  const { summary, log } = await run({ answers: { 'a@example.com': NONSENSE, 'c@example.com': NONSENSE } });
  assertEquals(summary, { asked: 3, saved: 1, no_objection: 0, refused: 0, held: 2, stopped: null });
  // Nothing is written for her; she is left alone for a while instead of asked every run.
  assertEquals(log.held, [
    { accountId: 'account-a', reason: 'no_answer' },
    { accountId: 'account-c', reason: 'no_answer' },
  ]);
  assertEquals(log.saved, ['account-b']);
  assertEquals(log.notedCancelled, 0);
});

Deno.test('weekly seats: running out of time stops cleanly before the next call', async () => {
  const { summary, log } = await run({ timeLeft: [9_000, 5_000, MIN_TIME_TO_ASK_MS - 1] });
  assertEquals(summary, { asked: 2, saved: 2, no_objection: 0, refused: 0, held: 0, stopped: 'out_of_time' });
  // A call never gets longer than what is left of the run.
  assertEquals(log.asked.map((a) => a.timeoutMs), [SEAT_CALL_TIMEOUT_MS, 5_000]);
  assertEquals(log.saved, ['account-a', 'account-b']);
  assertEquals(log.held, []);

  const none = await run({ timeLeft: [0] });
  assertEquals(none.summary, { asked: 0, saved: 0, no_objection: 0, refused: 0, held: 0, stopped: 'out_of_time' });
  assertEquals(none.log.asked, []);
});

Deno.test('weekly seats: once the meeting has ended nobody else is asked', async () => {
  let calls = 0;
  const { summary, log } = await run({ sameMeeting: () => ++calls < 2 });
  assertEquals(summary, { asked: 1, saved: 1, no_objection: 0, refused: 0, held: 0, stopped: 'out_of_time' });
  assertEquals(log.saved, ['account-a']);
});

Deno.test('weekly seats: a failed lookup, nobody to ask, and rows that cannot be used', async () => {
  const failed = await run({ rows: null });
  assertEquals(failed.summary, { asked: 0, saved: 0, no_objection: 0, refused: 0, held: 0, stopped: 'lookup_failed' });
  const nobody = await run({ rows: [] });
  assertEquals(nobody.summary, { asked: 0, saved: 0, no_objection: 0, refused: 0, held: 0, stopped: null });

  // No account, no email, the same account twice: each is skipped without a call.
  const { summary, log } = await run({
    rows: [
      null,
      { account_id: 7, email: 'x@example.com' },
      { account_id: 'account-x', email: 'not-an-email' },
      { account_id: 'account-a', email: ' A@Example.com ', name: '   ' },
      { account_id: 'account-a', email: 'a@example.com', name: 'Again' },
    ],
  });
  assertEquals(summary, { asked: 1, saved: 1, no_objection: 0, refused: 0, held: 0, stopped: null });
  // The name family-squares-register falls back to.
  assertEquals(log.asked, [{ email: 'a@example.com', name: 'Family', timeoutMs: SEAT_CALL_TIMEOUT_MS }]);
});
