import assert from 'node:assert/strict';
import test from 'node:test';
import { createBoundaryFollowThroughStore, localReviewDate, isReviewDate, reviewDue } from '../src/storage/boundaryFollowThroughCore';
const plan = { communicate: 'I care about you. I will not give cash.', action: 'I will offer groceries instead.', reviewDate: '2026-09-07', response: null, reviewedOn: null } as const;
function fixture() {
  const data = new Map<string, string>();
  const io = { getItem: async (k: string) => data.get(k) ?? null, setItem: async (k: string, v: string) => { data.set(k, v); } };
  return { data, io, store: createBoundaryFollowThroughStore(io) };
}
test('round trips private plans and isolates accounts', async () => {
  const { store } = fixture();
  await store.save('a', 'wall', plan);
  assert.deepEqual(await store.get('a', 'wall'), plan);
  assert.equal(await store.get('b', 'wall'), null);
  await assert.rejects(store.get('', 'wall'));
});
test('overlapping edits to different walls do not overwrite each other', async () => {
  const { store } = fixture();
  await Promise.all([store.save('a', 'one', plan), store.save('a', 'two', { ...plan, action: 'Take a break' })]);
  assert.equal((await store.get('a', 'one'))?.action, plan.action);
  assert.equal((await store.get('a', 'two'))?.action, 'Take a break');
});
test('deletion removes private text and rejects late writes', async () => {
  const { store, data } = fixture();
  await store.save('a', 'wall', plan);
  await store.remove('a', 'wall');
  await assert.rejects(store.save('a', 'wall', plan));
  assert.equal(await store.get('a', 'wall'), null);
  assert.ok(![...data.values()].join('').includes(plan.communicate));
});
test('successful wall reconciliation removes orphaned plans', async () => {
  const { store } = fixture();
  await store.save('a', 'gone', plan);
  await store.save('a', 'kept', plan);
  await store.prune('a', ['kept']);
  assert.equal(await store.get('a', 'gone'), null);
  assert.deepEqual(await store.get('a', 'kept'), plan);
});
test('corruption and future versions fail closed without overwriting', async () => {
  for (const raw of ['{bad', '{"version":99}', '{"version":1,"records":{"x":{}} ,"deleted":[]}']) {
    const { store, data } = fixture();
    await store.save('a', 'wall', plan);
    const key = [...data.keys()][0]; data.set(key, raw);
    await assert.rejects(store.get('a', 'wall'));
    await assert.rejects(store.save('a', 'wall', plan));
    assert.equal(data.get(key), raw);
  }
});
test('failed writes propagate and the queue recovers', async () => {
  const { io } = fixture(); let fail = true;
  const store = createBoundaryFollowThroughStore({ ...io, setItem: async (k, v) => { if (fail) throw Error('disk'); await io.setItem(k, v); } });
  await assert.rejects(store.save('a', 'w', plan)); fail = false;
  await store.save('a', 'w', plan); assert.deepEqual(await store.get('a', 'w'), plan);
});
test('date-only reviews use local calendar semantics and reject impossible dates', () => {
  assert.equal(localReviewDate(new Date(2026, 8, 7, 23, 59)), '2026-09-07');
  assert.equal(isReviewDate('2026-02-29'), false);
  assert.equal(isReviewDate('2028-02-29'), true);
  assert.equal(isReviewDate('09/07/2026'), false);
  assert.equal(reviewDue(plan, '2026-09-07'), true);
  assert.equal(reviewDue({ ...plan, response: 'not-yet', reviewedOn: '2026-09-07' }, '2026-09-08'), false);
});
test('all compassionate responses persist, malformed fields are rejected', async () => {
  const { store } = fixture();
  for (const response of ['yes', 'not-yet', 'adjust'] as const) {
    await store.save('a', 'wall', { ...plan, response, reviewedOn: '2026-09-07' });
    assert.equal((await store.get('a', 'wall'))?.response, response);
  }
  await assert.rejects(store.save('a', 'wall', { ...plan, reviewDate: '2026-02-30' }));
});
