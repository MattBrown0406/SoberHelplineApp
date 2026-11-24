import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AFTER_MEETING_GAP, createInvitationPolicy, DAY, invitationKey, legacyInvitationKey, MAX_IN_WINDOW, MIN_GAP,
  NEW_ACCOUNT_QUIET, NOT_NOW_SNOOZES, PLACEMENTS, UNANSWERED_LIMIT, UNANSWERED_PAUSE, WINDOW,
} from '../src/membershipInvitations/policy';
import { askedThisVisit, clearVisitAsks, noteReviewPending, noteVisitAsk } from '../src/membershipInvitations/visitAsks';

// An account well past its first days, unless a test says otherwise.
const OLD = { joinedAt: 0 };
function fixture(asked: (id: string) => boolean = () => false) {
  const data = new Map<string, string>(); let time = 100 * DAY; let writes = 0;
  const storage = { getItem: async (k: string) => data.get(k) ?? null, setItem: async (k: string, v: string) => { writes++; data.set(k, v); } };
  return { data, storage, policy: createInvitationPolicy(storage, () => time, asked), advance: (n: number) => { time += n; }, writes: () => writes, clock: () => time };
}
const yes = () => true;
const record = (f: ReturnType<typeof fixture>, id = 'a') => JSON.parse(f.data.get(invitationKey(id))!);

test('the limits are the agreed ones', () => {
  assert.equal(MIN_GAP, 7 * DAY);
  assert.equal(WINDOW, 30 * DAY);
  assert.equal(MAX_IN_WINDOW, 3);
  assert.equal(NEW_ACCOUNT_QUIET, 3 * DAY);
  assert.equal(AFTER_MEETING_GAP, 14 * DAY);
  assert.deepEqual(NOT_NOW_SNOOZES, [7 * DAY, 14 * DAY, 30 * DAY]);
  assert.equal(UNANSWERED_LIMIT, 3);
  assert.equal(UNANSWERED_PAUSE, 30 * DAY);
  assert.deepEqual([...PLACEMENTS], ['practice-completed', 'boundary-saved', 'after-meeting', 'tool-finished', 'checkin-week']);
});

test('initial construction is read/write free; explicit eligible claims serialize across placements', async () => {
  const f = fixture(); assert.equal(f.writes(), 0);
  assert.deepEqual(await Promise.all([
    f.policy.claim('a', 'practice-completed', yes, OLD), f.policy.claim('a', 'checkin-week', yes, OLD), f.policy.claim('a', 'tool-finished', yes, OLD),
  ]), [true, false, false]);
  assert.equal(f.writes(), 1);
});

test('one invitation every 7 days across every placement, kept across a restart; a visible card excludes the others', async () => {
  const f = fixture(); assert.equal(await f.policy.claim('a', 'boundary-saved', yes, OLD), true);
  assert.equal(await f.policy.claim('a', 'tool-finished', yes, OLD), false, 'one card at a time');
  f.policy.release('a');
  const restarted = createInvitationPolicy(f.storage, f.clock);
  assert.equal(await restarted.claim('a', 'practice-completed', yes, OLD), false);
  f.advance(7 * DAY - 1);
  for (const placement of PLACEMENTS) assert.equal(await f.policy.claim('a', placement, yes, OLD), false, placement);
  f.advance(1);
  assert.equal(await f.policy.claim('a', 'checkin-week', yes, OLD), true);
});

test('at most 3 in any 30 days', async () => {
  const f = fixture();
  // Each one tapped, so the unanswered pause plays no part here.
  for (let i = 0; i < 3; i++) {
    assert.equal(await f.policy.claim('a', 'tool-finished', yes, OLD), true, `invitation ${i + 1}`);
    await f.policy.tapped('a', yes);
    f.advance(7 * DAY);
  }
  // Day 21: the gap has passed, but three were shown in the last 30 days.
  assert.equal(await f.policy.claim('a', 'tool-finished', yes, OLD), false);
  f.advance(7 * DAY); // day 28: still three within 30 days
  assert.equal(await f.policy.claim('a', 'tool-finished', yes, OLD), false);
  f.advance(2 * DAY); // day 30: the first one has left the window
  assert.equal(await f.policy.claim('a', 'tool-finished', yes, OLD), true);
  assert.equal(record(f).shownAt.length, 3, 'only the last 30 days are kept');
});

test('none in her first 3 days, and an unknown start counts as new', async () => {
  const f = fixture();
  assert.equal(await f.policy.claim('a', 'practice-completed', yes, { joinedAt: null }), false);
  assert.equal(await f.policy.claim('a', 'practice-completed', yes, { joinedAt: Number.NaN }), false);
  assert.equal(await f.policy.claim('a', 'practice-completed', yes, { joinedAt: f.clock() - 3 * DAY + 1 }), false);
  assert.equal(await f.policy.claim('a', 'practice-completed', yes, { joinedAt: f.clock() + DAY }), false, 'a start in the future is not old');
  assert.equal(f.writes(), 0, 'a refusal writes nothing');
  assert.equal(await f.policy.claim('a', 'practice-completed', yes, { joinedAt: f.clock() - 3 * DAY }), true);
});

test('"Not now" snoozes 7 days, then 14, then 30 each time; "Don\'t show again" is permanent', async () => {
  const f = fixture();
  for (const snooze of [7, 14, 30, 30]) {
    assert.equal(await f.policy.claim('a', 'boundary-saved', yes, OLD), true, `before the ${snooze}-day snooze`);
    assert.equal(await f.policy.dismiss('a', false, yes), true);
    assert.equal(record(f).snoozedUntil, f.clock() + snooze * DAY, `${snooze} days`);
    // Only the snooze is in the way here (7 days > the gap, and one showing in the window).
    f.advance(Math.max(snooze, 7) * DAY - 1);
    assert.equal(await f.policy.claim('a', 'boundary-saved', yes, OLD), false, `${snooze} days, not yet`);
    f.advance(1);
    assert.equal(await f.policy.claim('a', 'boundary-saved', yes, OLD), true, `${snooze} days, over`);
    await f.policy.tapped('a', yes);
    f.advance(31 * DAY);
  }
  assert.equal(record(f).notNowCount, 4);
  assert.equal(await f.policy.claim('a', 'boundary-saved', yes, OLD), true);
  await f.policy.dismiss('a', true, yes); f.advance(400 * DAY);
  assert.equal(await createInvitationPolicy(f.storage, f.clock).claim('a', 'boundary-saved', yes, OLD), false);
});

test('three in a row left unanswered: a 30-day pause; tapping or dismissing starts the count again', async () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) {
    assert.equal(await f.policy.claim('a', 'tool-finished', yes, OLD), true);
    f.policy.release('a'); // she left without answering
    f.advance(10 * DAY);
  }
  assert.equal(record(f).unanswered, 3);
  // Day 30 after the third: everything else allows it, the pause does not.
  f.advance(20 * DAY - 1);
  assert.equal(await f.policy.claim('a', 'tool-finished', yes, OLD), false);
  f.advance(1);
  assert.equal(await f.policy.claim('a', 'tool-finished', yes, OLD), true, 'after the pause');
  assert.equal(record(f).unanswered, 1, 'the run starts again after the pause');
  await f.policy.tapped('a', yes);
  assert.equal(record(f).unanswered, 0);
  // Two ignored, then "Not now", then two more ignored: never three in a row.
  for (const answered of [false, false, true, false, false]) {
    f.advance(35 * DAY);
    assert.equal(await f.policy.claim('a', 'checkin-week', yes, OLD), true);
    if (answered) await f.policy.dismiss('a', false, yes); else f.policy.release('a');
  }
  f.advance(35 * DAY);
  assert.equal(await f.policy.claim('a', 'checkin-week', yes, OLD), true);
});

test('one ask per visit: a visit with another ask claims nothing and writes nothing', async () => {
  let asked = true;
  const f = fixture(() => asked);
  for (const placement of PLACEMENTS) assert.equal(await f.policy.claim('a', placement, yes, OLD), false, placement);
  assert.equal(f.writes(), 0);
  asked = false;
  assert.equal(await f.policy.claim('a', 'after-meeting', yes, OLD), true);
});

test('visitAsks: the rating prompt (running or requested) and the reminder ask hold invitations back for the visit', () => {
  clearVisitAsks();
  assert.equal(askedThisVisit('a'), false);
  assert.equal(askedThisVisit(null), true, 'no account: nothing is offered');
  // A rating-prompt check running counts; once it ends with nothing shown, it does not.
  noteReviewPending('a', true);
  assert.equal(askedThisVisit('a'), true);
  assert.equal(askedThisVisit('b'), false, 'per account');
  noteReviewPending('a', false);
  assert.equal(askedThisVisit('a'), false);
  // Requested (or the reminder ask): for the rest of the visit.
  noteVisitAsk('a');
  assert.equal(askedThisVisit('a'), true);
  clearVisitAsks();
  assert.equal(askedThisVisit('a'), false, 'the next visit starts clear');
  // A check still running when the visit ends keeps counting until it ends.
  noteReviewPending('a', true); clearVisitAsks();
  assert.equal(askedThisVisit('a'), true);
  noteReviewPending('a', false);
  assert.equal(askedThisVisit('a'), false);
});

test('account isolation and stale/logged-out scope are fail closed without writes', async () => {
  const f = fixture(); await f.policy.dismiss('a', true, yes);
  assert.equal(await f.policy.claim('b', 'boundary-saved', yes, OLD), true);
  assert.equal(await f.policy.claim('c', 'boundary-saved', () => false, OLD), false);
  assert.equal(f.data.has(invitationKey('c')), false);
  let active = true; let resolve!: (v: string | null) => void; let writes = 0;
  let reads = 0;
  // The first read is slow (the account changes meanwhile); any later read answers at once.
  const p = createInvitationPolicy({ getItem: () => reads++ ? Promise.resolve(null) : new Promise(r => { resolve = r; }), setItem: async () => { writes++; } });
  const pending = p.claim('old', 'practice-completed', () => active, OLD);
  await Promise.resolve(); active = false; resolve(null);
  assert.equal(await pending, false); assert.equal(writes, 0);
});

test('read, write, corrupt and unsupported storage fail closed', async () => {
  for (const mode of ['read', 'write', 'corrupt', 'version', 'damaged-v2']) {
    const p = createInvitationPolicy({ getItem: async () => {
      if (mode === 'read') throw Error();
      return mode === 'corrupt' ? '{' : mode === 'version' ? '{"version":3}'
        : mode === 'damaged-v2' ? JSON.stringify({ version: 2, optedOut: false, snoozedUntil: 0, notNowCount: 0, shownAt: ['yesterday'], afterMeetingAt: null, unanswered: 0 }) : null;
    }, setItem: async () => { throw Error(); } }, () => 100 * DAY);
    assert.equal(await p.claim('a', 'boundary-saved', yes, OLD), false, mode);
    assert.equal(await p.claim('a', 'practice-completed', yes, OLD), false, mode);
  }
});

test('runtime rejects non-neutral placement and clock rollback', async () => {
  const f = fixture(); assert.equal(await f.policy.claim('a', 'crisis' as never, yes, OLD), false);
  await f.policy.claim('a', 'boundary-saved', yes, OLD); f.policy.release('a'); f.advance(-DAY);
  assert.equal(await f.policy.claim('a', 'boundary-saved', yes, OLD), false);
});

test('after Family Squares: at most once every 14 days, on top of every other limit', async () => {
  const f = fixture();
  assert.equal(await f.policy.claim('a', 'after-meeting', yes, OLD), true);
  await f.policy.tapped('a', yes);
  // A week later (the next meeting): the 7-day gap has passed, the 14 days have not.
  f.advance(7 * DAY);
  assert.equal(await f.policy.claim('a', 'after-meeting', yes, OLD), false);
  // The other invitations are not held back by it.
  assert.equal(await f.policy.claim('a', 'boundary-saved', yes, OLD), true);
  await f.policy.tapped('a', yes);
  f.advance(7 * DAY);
  assert.equal(await f.policy.claim('a', 'after-meeting', yes, OLD), true);
  await f.policy.tapped('a', yes);
  // A restart keeps the 14 days (they are stored, not remembered).
  f.advance(13 * DAY);
  assert.equal(await createInvitationPolicy(f.storage, f.clock).claim('a', 'after-meeting', yes, OLD), false);
});

test('a version-1 record (4.3) is read safely and becomes version 2 on the next write; a damaged one fails closed', async () => {
  const f = fixture();
  // Shown 6 days ago under 4.3, after a "Not now" that has run out.
  f.data.set(legacyInvitationKey('old'), JSON.stringify({ version: 1, optedOut: false, snoozedUntil: f.clock() - DAY, lastShownAt: f.clock() - 6 * DAY, afterMeetingAt: f.clock() - 6 * DAY }));
  assert.equal(await f.policy.claim('old', 'tool-finished', yes, OLD), false, 'its last showing still counts toward the 7 days');
  assert.equal(f.data.has(invitationKey('old')), false, 'a refusal writes nothing');
  f.advance(DAY);
  assert.equal(await f.policy.claim('old', 'after-meeting', yes, OLD), false, 'its after-meeting time still counts toward the 14 days');
  assert.equal(await f.policy.claim('old', 'tool-finished', yes, OLD), true);
  const upgraded = record(f, 'old');
  assert.equal(upgraded.version, 2);
  assert.deepEqual(upgraded.shownAt, [f.clock() - 7 * DAY, f.clock()]);
  assert.equal(upgraded.notNowCount, 1, 'her earlier "Not now" counts: the next one is 14 days');
  assert.ok(f.data.has(legacyInvitationKey('old')), 'the old record is left as it was');
  // The next "Not now" is the second one.
  await f.policy.dismiss('old', false, yes);
  assert.equal(record(f, 'old').snoozedUntil, f.clock() + 14 * DAY);
  // A version-1 record written before the after-meeting invitation existed.
  f.data.set(legacyInvitationKey('older'), JSON.stringify({ version: 1, optedOut: false, snoozedUntil: 0, lastShownAt: null }));
  assert.equal(await f.policy.claim('older', 'after-meeting', yes, OLD), true);
  assert.equal(record(f, 'older').afterMeetingAt, f.clock());
  // "Don't show again" under 4.3 stays.
  f.data.set(legacyInvitationKey('out'), JSON.stringify({ version: 1, optedOut: true, snoozedUntil: 0, lastShownAt: null }));
  assert.equal(await f.policy.claim('out', 'tool-finished', yes, OLD), false);
  f.data.set(legacyInvitationKey('bad'), JSON.stringify({ version: 1, optedOut: false, snoozedUntil: 0, lastShownAt: null, afterMeetingAt: 'yesterday' }));
  assert.equal(await f.policy.claim('bad', 'after-meeting', yes, OLD), false);
});
