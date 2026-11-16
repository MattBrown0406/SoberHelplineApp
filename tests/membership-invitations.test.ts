import test from 'node:test';
import assert from 'node:assert/strict';
import { AFTER_MEETING_GAP, createInvitationPolicy, DAY, invitationKey } from '../src/membershipInvitations/policy';
function fixture() {
  const data = new Map<string, string>(); let time = 100 * DAY; let writes = 0;
  const storage = { getItem: async (k: string) => data.get(k) ?? null, setItem: async (k: string, v: string) => { writes++; data.set(k, v); } };
  return { data, storage, policy: createInvitationPolicy(storage, () => time), advance: (n: number) => { time += n; }, writes: () => writes, clock: () => time };
}
const yes = () => true;
test('initial construction is read/write free; explicit eligible claims serialize across placements', async () => {
  const f = fixture(); assert.equal(f.writes(), 0);
  assert.deepEqual(await Promise.all([f.policy.claim('a', 'practice-completed', yes), f.policy.claim('a', 'boundary-saved', yes)]), [true, false]);
  assert.equal(f.writes(), 1);
});
test('remount/restart preserves rolling daily limit and active invitation excludes siblings', async () => {
  const f = fixture(); assert.equal(await f.policy.claim('a', 'boundary-saved', yes), true);
  const restarted = createInvitationPolicy(f.storage, f.clock);
  assert.equal(await restarted.claim('a', 'practice-completed', yes), false);
  f.advance(DAY);
  assert.equal(await f.policy.claim('a', 'practice-completed', yes), false);
  f.policy.release('a');
  assert.equal(await f.policy.claim('a', 'practice-completed', yes), true);
});
test('Not now persists seven-day cooldown; permanent optout survives restart', async () => {
  const f = fixture(); await f.policy.claim('a', 'boundary-saved', yes);
  assert.equal(await f.policy.dismiss('a', false, yes), true);
  f.advance(7 * DAY - 1); assert.equal(await f.policy.claim('a', 'boundary-saved', yes), false);
  f.advance(1); assert.equal(await f.policy.claim('a', 'boundary-saved', yes), true);
  await f.policy.dismiss('a', true, yes); f.advance(400 * DAY);
  assert.equal(await createInvitationPolicy(f.storage, f.clock).claim('a', 'boundary-saved', yes), false);
});
test('account isolation and stale/logged-out scope are fail closed without writes', async () => {
  const f = fixture(); await f.policy.dismiss('a', true, yes);
  assert.equal(await f.policy.claim('b', 'boundary-saved', yes), true);
  assert.equal(await f.policy.claim('c', 'boundary-saved', () => false), false);
  assert.equal(f.data.has(invitationKey('c')), false);
  let active = true; let resolve!: (v: string | null) => void; let writes = 0;
  const p = createInvitationPolicy({ getItem: () => new Promise(r => { resolve = r; }), setItem: async () => { writes++; } });
  const pending = p.claim('old', 'practice-completed', () => active);
  await Promise.resolve(); active = false; resolve(null);
  assert.equal(await pending, false); assert.equal(writes, 0);
});
test('read, write, corrupt and unsupported storage fail closed', async () => {
  for (const mode of ['read', 'write', 'corrupt', 'version']) {
    const p = createInvitationPolicy({ getItem: async () => { if (mode === 'read') throw Error(); return mode === 'corrupt' ? '{' : mode === 'version' ? '{"version":2}' : null; }, setItem: async () => { throw Error(); } });
    assert.equal(await p.claim('a', 'boundary-saved', yes), false);
    assert.equal(await p.claim('a', 'practice-completed', yes), false);
  }
});
test('runtime rejects non-neutral placement and clock rollback', async () => {
  const f = fixture(); assert.equal(await f.policy.claim('a', 'crisis' as never, yes), false);
  await f.policy.claim('a', 'boundary-saved', yes); f.policy.release('a'); f.advance(-DAY);
  assert.equal(await f.policy.claim('a', 'boundary-saved', yes), false);
});
test('after Family Squares: at most once every 14 days, on top of every other limit', async () => {
  assert.equal(AFTER_MEETING_GAP, 14 * DAY);
  const f = fixture();
  assert.equal(await f.policy.claim('a', 'after-meeting', yes), true);
  f.policy.release('a');
  // A week later (the next meeting): the daily limit has passed, the 14 days have not.
  f.advance(7 * DAY);
  assert.equal(await f.policy.claim('a', 'after-meeting', yes), false);
  // The other invitations keep their own daily limit and are not held back by it.
  assert.equal(await f.policy.claim('a', 'boundary-saved', yes), true);
  f.policy.release('a');
  f.advance(7 * DAY - 1);
  assert.equal(await f.policy.claim('a', 'after-meeting', yes), false);
  f.advance(1);
  assert.equal(await f.policy.claim('a', 'after-meeting', yes), true);
  // A restart keeps the 14 days (they are stored, not remembered).
  f.advance(13 * DAY);
  assert.equal(await createInvitationPolicy(f.storage, f.clock).claim('a', 'after-meeting', yes), false);
});
test('after Family Squares: another invitation that day, "Not now" and "Don\'t show again" all hold it back', async () => {
  const f = fixture();
  assert.equal(await f.policy.claim('a', 'practice-completed', yes), true);
  f.policy.release('a');
  f.advance(DAY - 1);
  assert.equal(await f.policy.claim('a', 'after-meeting', yes), false, 'one invitation a day, whichever it is');
  f.advance(1);
  assert.equal(await f.policy.claim('a', 'after-meeting', yes), true);
  await f.policy.dismiss('a', false, yes);
  f.advance(14 * DAY);
  assert.equal(await f.policy.claim('a', 'after-meeting', yes), true, 'after "Not now" and the 14 days');
  await f.policy.dismiss('a', true, yes);
  f.advance(400 * DAY);
  assert.equal(await f.policy.claim('a', 'after-meeting', yes), false, 'never again after "Don\'t show again"');
});
test('a record written before the after-meeting invitation existed is still read; a damaged one fails closed', async () => {
  const f = fixture();
  f.data.set(invitationKey('old'), JSON.stringify({ version: 1, optedOut: false, snoozedUntil: 0, lastShownAt: null }));
  assert.equal(await f.policy.claim('old', 'after-meeting', yes), true);
  assert.equal(JSON.parse(f.data.get(invitationKey('old'))!).afterMeetingAt, f.clock());
  f.data.set(invitationKey('bad'), JSON.stringify({ version: 1, optedOut: false, snoozedUntil: 0, lastShownAt: null, afterMeetingAt: 'yesterday' }));
  assert.equal(await f.policy.claim('bad', 'after-meeting', yes), false);
  // A clock that moved backwards never brings it back early.
  f.policy.release('old'); f.advance(-DAY);
  assert.equal(await f.policy.claim('old', 'after-meeting', yes), false);
});
