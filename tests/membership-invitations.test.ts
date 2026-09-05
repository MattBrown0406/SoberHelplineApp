import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvitationPolicy, DAY, invitationKey } from '../src/membershipInvitations/policy';
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
