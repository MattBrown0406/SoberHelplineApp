import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PersonalReminderService, REMINDER_PREFIX, type ReminderBoundary } from './personalReminders';

function fixture() {
  const disk = new Map<string, string>();
  const scheduled = new Set<string>();
  const calls: string[] = [];
  let granted = true;
  const boundary: ReminderBoundary = {
    supported: true,
    read: async key => disk.get(key) ?? null,
    write: async (key, value) => { disk.set(key, value); },
    list: async () => [...scheduled],
    cancel: async id => { calls.push('cancel'); scheduled.delete(id); },
    permission: async request => { calls.push(request ? 'request' : 'check'); return granted; },
    schedule: async (id, hour, minute, locale) => { calls.push('schedule'); scheduled.add(id); },
    id: () => `${REMINDER_PREFIX}${calls.length}-${scheduled.size}`,
  };
  return { boundary, disk, scheduled, calls, deny: () => { granted = false; }, service: new PersonalReminderService(boundary) };
}

test('hydrate never requests permission; explicit enable schedules then pause/resume/delete', async () => {
  const f = fixture();
  await f.service.setAccount('a');
  assert.deepEqual(f.calls, []);
  await f.service.enable('boundary', 9, 30, 'en');
  assert.equal(f.service.snapshot().items[0].enabled, true);
  assert.equal(f.scheduled.size, 1);
  await f.service.pause('boundary');
  assert.equal(f.scheduled.size, 0);
  assert.equal(f.service.snapshot().items[0].enabled, false);
  await f.service.enable('boundary', 9, 30, 'en');
  await f.service.remove('boundary');
  assert.equal(f.scheduled.size, 0);
  assert.deepEqual(f.service.snapshot().items, []);
});

test('denial and web do not claim scheduled', async () => {
  const f = fixture(); await f.service.setAccount('a'); f.deny();
  await assert.rejects(f.service.enable('learning', 8, 0, 'en'), /permission/);
  assert.equal(f.scheduled.size, 0);
  const web = fixture(); web.boundary.supported = false;
  await web.service.setAccount('a');
  await assert.rejects(web.service.enable('learning', 8, 0, 'en'), /unavailable/);
  assert.deepEqual(web.calls, []);
});

test('schedule that throws after native side effect rolls back known identifier', async () => {
  const f = fixture(); await f.service.setAccount('a');
  f.boundary.schedule = async id => { f.scheduled.add(id); throw Error('native'); };
  await assert.rejects(f.service.enable('meeting', 12, 0, 'es'));
  assert.equal(f.scheduled.size, 0);
  assert.equal(f.service.snapshot().items.length, 0);
});

test('persistence failure rolls back schedule', async () => {
  const f = fixture(); await f.service.setAccount('a');
  f.boundary.write = async () => { throw Error('disk'); };
  await assert.rejects(f.service.enable('coaching', 12, 0, 'es'));
  assert.equal(f.scheduled.size, 0);
});

test('account change fences delayed permission and clears view immediately', async () => {
  const f = fixture(); await f.service.setAccount('a');
  let release!: (value: boolean) => void;
  f.boundary.permission = () => new Promise(resolve => { release = resolve; });
  const enable = f.service.enable('boundary', 9, 0, 'en');
  await new Promise(resolve => setImmediate(resolve));
  const change = f.service.setAccount('b');
  assert.deepEqual(f.service.snapshot().items, []);
  release(true);
  await assert.rejects(enable, /account/); await change;
  assert.equal(f.scheduled.size, 0);
  assert.deepEqual(f.service.snapshot().items, []);
});

test('logout cancels only own notifications; returning account is paused', async () => {
  const f = fixture(); await f.service.setAccount('a');
  await f.service.enable('boundary', 9, 0, 'en'); f.scheduled.add('practice-existing');
  await f.service.setAccount(null);
  assert.deepEqual([...f.scheduled], ['practice-existing']);
  await f.service.setAccount('a');
  assert.equal(f.service.snapshot().items[0].enabled, false);
});

test('corrupt storage cancels owned schedules and blocks edits', async () => {
  const f = fixture(); await f.service.setAccount('a'); await f.service.enable('learning', 9, 0, 'en');
  for (const key of f.disk.keys()) f.disk.set(key, '{broken');
  const restart = new PersonalReminderService(f.boundary);
  await assert.rejects(restart.setAccount('a'), /storage/);
  assert.equal(f.scheduled.size, 0);
  assert.equal(restart.snapshot().ready, false);
});

test('cancel failure is visible, never marked paused or deleted; retry recovers', async () => {
  const f = fixture(); await f.service.setAccount('a'); await f.service.enable('meeting', 9, 0, 'en');
  const cancel = f.boundary.cancel; f.boundary.cancel = async () => { throw Error('cancel failed'); };
  await assert.rejects(f.service.pause('meeting'));
  assert.equal(f.service.snapshot().ready, false);
  assert.ok(f.service.snapshot().error);
  assert.equal(f.scheduled.size, 1);
  f.boundary.cancel = cancel; await f.service.setAccount('a');
  await f.service.pause('meeting'); assert.equal(f.scheduled.size, 0);
});

test('invalid times and overlapping enable calls cannot duplicate category', async () => {
  const f = fixture(); await f.service.setAccount('a');
  await assert.rejects(f.service.enable('learning', 24, 0, 'en'));
  const results = await Promise.allSettled([f.service.enable('learning', 9, 0, 'en'), f.service.enable('learning', 10, 0, 'en')]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(f.scheduled.size, 1);
});

test('restart preserves valid opt-in without requesting permission; revoked permission cancels', async () => {
  const f = fixture(); await f.service.setAccount('a'); await f.service.enable('coaching', 16, 45, 'es');
  f.calls.length = 0;
  const restarted = new PersonalReminderService(f.boundary); await restarted.setAccount('a');
  assert.equal(restarted.snapshot().items[0].enabled, true);
  assert.deepEqual(f.calls, ['check']);
  f.deny(); await restarted.setAccount('a');
  assert.equal(f.scheduled.size, 0); assert.equal(restarted.snapshot().items[0].enabled, false);
});

test('late native scheduling after logout is rolled back before logout resolves', async () => {
  const f = fixture(); await f.service.setAccount('a');
  let release!: () => void;
  f.boundary.schedule = async id => { await new Promise<void>(resolve => { release = resolve; }); f.scheduled.add(id); };
  const adding = f.service.enable('learning', 10, 0, 'en');
  await new Promise(resolve => setImmediate(resolve));
  const logout = f.service.setAccount(null); release();
  await assert.rejects(adding, /account/); await logout;
  assert.equal(f.scheduled.size, 0); assert.equal(f.disk.size, 0);
});

test('foreground during explicit permission preserves the edit and existing categories', async () => {
  const f = fixture(); await f.service.setAccount('a');
  await f.service.enable('boundary', 9, 0, 'en');
  let release!: (value: boolean) => void;
  f.boundary.permission = request => request ? new Promise(resolve => { release = resolve; }) : Promise.resolve(true);
  const adding = f.service.enable('learning', 10, 30, 'en');
  await new Promise(resolve => setImmediate(resolve));
  const foreground = f.service.setAccount('a');
  release(true);
  await adding; await foreground;
  assert.equal(f.scheduled.size, 2);
  assert.deepEqual(f.service.snapshot().items.map(r => r.category).sort(), ['boundary', 'learning']);
});

test('failed account-switch cancellation remains required when returning to the old account', async () => {
  const f = fixture(); await f.service.setAccount('a');
  await f.service.enable('boundary', 9, 0, 'en');
  const cancel = f.boundary.cancel;
  f.boundary.cancel = async () => { throw Error('cancel'); };
  await assert.rejects(f.service.setAccount('b'), /cancel/);
  f.boundary.cancel = cancel;
  await f.service.setAccount('a');
  assert.equal(f.scheduled.size, 0);
  assert.equal(f.service.snapshot().items[0].enabled, false);
});

test('unconfirmed native cancellation fails rather than reporting success', async () => {
  const f = fixture(); await f.service.setAccount('a'); await f.service.enable('boundary', 10, 0, 'en');
  f.boundary.cancel = async () => undefined;
  await assert.rejects(f.service.remove('boundary'), /cancel/);
  assert.equal(f.service.snapshot().ready, false); assert.equal(f.scheduled.size, 1);
});

test('cross-account records and duplicate categories fail closed', async () => {
  for (const mutate of [
    (doc: any) => { doc.accountId = 'other'; },
    (doc: any) => { doc.items.push(doc.items[0]); },
    (doc: any) => { doc.items[0].notificationId = 'practice-existing'; },
    (doc: any) => { doc.items[0].hour = 99; },
  ]) {
    const f = fixture(); await f.service.setAccount('a'); await f.service.enable('boundary', 9, 0, 'en');
    for (const [key, value] of f.disk) { const doc = JSON.parse(value); mutate(doc); f.disk.set(key, JSON.stringify(doc)); }
    f.scheduled.add('practice-existing');
    await assert.rejects(new PersonalReminderService(f.boundary).setAccount('a'), /storage/);
    assert.deepEqual([...f.scheduled], ['practice-existing']);
  }
});
