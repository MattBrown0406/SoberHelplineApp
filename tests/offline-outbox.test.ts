import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  classifyOutboxError,
  createOfflineOutbox,
  emitOutboxReplay,
  outboxKeyFor,
  parseOutbox,
  subscribeOutboxReplay,
  type CheckInOutboxPayload,
  type OutboxHandlers,
  type OutboxItem,
  type OutboxStorage,
} from '../src/lib/offlineOutbox';

class MemoryStorage implements OutboxStorage {
  values = new Map<string, string>();
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
}

const ACCOUNT = 'account-a';
const OTHER = 'account-b';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function checkin(n: number, accountId = ACCOUNT, overrides: Partial<CheckInOutboxPayload> = {}): OutboxItem {
  return {
    id: uuid(n), kind: 'checkin', queuedAt: `2026-09-1${n % 10}T08:00:00.000Z`,
    payload: {
      id: uuid(n), account_id: accountId, mood: 3, capacity: 4, pressure: 2, support_need: 'rest',
      note: null, created_at: `2026-09-1${n % 10}T08:00:00.000Z`, checkin_date: `2026-09-1${n % 10}`, ...overrides,
    },
  };
}

function journal(n: number, accountId = ACCOUNT): OutboxItem {
  return {
    id: uuid(n), kind: 'journal', queuedAt: '2026-09-16T09:00:00.000Z',
    payload: { id: uuid(n), family_space_id: 'space-1', account_id: accountId, note: `note ${n}`, created_at: '2026-09-16T09:00:00.000Z' },
  };
}

function recordingHandlers(fail: (item: { kind: string; id: string }) => unknown = () => null) {
  const calls: string[] = [];
  const handlers: OutboxHandlers = {
    async checkin(payload) { calls.push(`checkin:${payload.id}`); const error = fail({ kind: 'checkin', id: payload.id }); if (error) throw error; },
    async journal(payload) { calls.push(`journal:${payload.id}`); const error = fail({ kind: 'journal', id: payload.id }); if (error) throw error; },
  };
  return { calls, handlers };
}

test('enqueue persists a versioned per-account record and dedupes by client id', async () => {
  const storage = new MemoryStorage();
  const outbox = createOfflineOutbox(storage);
  assert.equal(await outbox.enqueue(ACCOUNT, checkin(1)), true);
  assert.equal(await outbox.enqueue(ACCOUNT, checkin(1)), false);
  assert.equal(await outbox.enqueue(ACCOUNT, journal(2)), true);
  const raw = JSON.parse(storage.values.get(outboxKeyFor(ACCOUNT)) ?? 'null');
  assert.equal(raw.version, 1);
  assert.equal(raw.accountId, ACCOUNT);
  assert.deepEqual((await outbox.list(ACCOUNT)).map((item) => item.id), [uuid(1), uuid(2)]);
});

test('enqueue rejects items that do not belong to the account or are malformed', async () => {
  const outbox = createOfflineOutbox(new MemoryStorage());
  await assert.rejects(outbox.enqueue(ACCOUNT, checkin(1, OTHER)), /outbox_item_invalid/);
  await assert.rejects(outbox.enqueue(ACCOUNT, { ...checkin(1), id: 'not-a-uuid' } as OutboxItem), /outbox_item_invalid/);
  await assert.rejects(outbox.enqueue(ACCOUNT, checkin(1, ACCOUNT, { mood: 9 })), /outbox_item_invalid/);
  assert.deepEqual(await outbox.list(ACCOUNT), []);
});

test('replay runs in enqueue order and clears the record when everything lands', async () => {
  const storage = new MemoryStorage();
  const outbox = createOfflineOutbox(storage);
  await outbox.enqueue(ACCOUNT, checkin(3));
  await outbox.enqueue(ACCOUNT, journal(1));
  await outbox.enqueue(ACCOUNT, checkin(2));
  const { calls, handlers } = recordingHandlers();
  const result = await outbox.replay(ACCOUNT, handlers);
  assert.deepEqual(calls, [`checkin:${uuid(3)}`, `journal:${uuid(1)}`, `checkin:${uuid(2)}`]);
  assert.equal(result.synced.length, 3);
  assert.equal(result.remaining.length, 0);
  assert.equal(storage.values.has(outboxKeyFor(ACCOUNT)), false);
});

test('replay keeps order across a partial failure and treats a duplicate as already synced', async () => {
  const outbox = createOfflineOutbox(new MemoryStorage());
  await outbox.enqueue(ACCOUNT, checkin(1));
  await outbox.enqueue(ACCOUNT, journal(2));
  await outbox.enqueue(ACCOUNT, checkin(3));
  await outbox.enqueue(ACCOUNT, checkin(4));
  let offline = true;
  const { calls, handlers } = recordingHandlers(({ id }) => {
    if (id === uuid(1)) return { code: '23505', message: 'duplicate key value' };
    if (id === uuid(3) && offline) return new Error('Network request failed');
    return null;
  });
  const first = await outbox.replay(ACCOUNT, handlers);
  assert.deepEqual(first.synced.map((item) => item.id), [uuid(1), uuid(2)]);
  assert.deepEqual(first.remaining.map((item) => item.id), [uuid(3), uuid(4)]);
  assert.deepEqual(calls, [`checkin:${uuid(1)}`, `journal:${uuid(2)}`, `checkin:${uuid(3)}`]);
  assert.deepEqual((await outbox.list(ACCOUNT)).map((item) => item.id), [uuid(3), uuid(4)]);

  offline = false;
  const second = await outbox.replay(ACCOUNT, handlers);
  assert.deepEqual(second.synced.map((item) => item.id), [uuid(3), uuid(4)]);
  assert.deepEqual(await outbox.list(ACCOUNT), []);
});

test('replay drops permanently rejected items without blocking the rest', async () => {
  const outbox = createOfflineOutbox(new MemoryStorage());
  await outbox.enqueue(ACCOUNT, journal(1));
  await outbox.enqueue(ACCOUNT, checkin(2));
  const { handlers } = recordingHandlers(({ id }) => id === uuid(1) ? { code: '42501', message: 'row-level security' } : null);
  const result = await outbox.replay(ACCOUNT, handlers);
  assert.deepEqual(result.dropped.map((item) => item.id), [uuid(1)]);
  assert.deepEqual(result.synced.map((item) => item.id), [uuid(2)]);
  assert.deepEqual(await outbox.list(ACCOUNT), []);
});

test('error classification: duplicates sync, data/permission errors drop, network and unknown retry', () => {
  assert.equal(classifyOutboxError({ code: '23505' }), 'synced');
  assert.equal(classifyOutboxError({ code: '23514', message: 'check constraint' }), 'drop');
  assert.equal(classifyOutboxError({ code: '22P02' }), 'drop');
  assert.equal(classifyOutboxError({ code: '42501' }), 'drop');
  assert.equal(classifyOutboxError({ status: 403 }), 'drop');
  assert.equal(classifyOutboxError({ status: 503 }), 'retry');
  assert.equal(classifyOutboxError(new TypeError('Network request failed')), 'retry');
  assert.equal(classifyOutboxError({ message: 'fetch failed' }), 'retry');
  assert.equal(classifyOutboxError(new Error('something unexpected')), 'retry');
});

test('corrupted records fail closed: nothing invalid is replayed and the record is rewritten', async () => {
  const storage = new MemoryStorage();
  const outbox = createOfflineOutbox(storage);
  const { calls, handlers } = recordingHandlers();

  storage.values.set(outboxKeyFor(ACCOUNT), '{not json');
  assert.deepEqual(parseOutbox('{not json', ACCOUNT), { items: [], corrupted: true });
  await outbox.replay(ACCOUNT, handlers);
  assert.deepEqual(calls, []);
  assert.equal(storage.values.has(outboxKeyFor(ACCOUNT)), false);

  storage.values.set(outboxKeyFor(ACCOUNT), JSON.stringify({ version: 2, accountId: ACCOUNT, items: [checkin(1)] }));
  assert.deepEqual(await outbox.list(ACCOUNT), []);

  const mixed = { version: 1, accountId: ACCOUNT, items: [checkin(1), { id: uuid(2), kind: 'checkin', payload: { mood: 'bad' } }, journal(3)] };
  storage.values.set(outboxKeyFor(ACCOUNT), JSON.stringify(mixed));
  const parsed = parseOutbox(JSON.stringify(mixed), ACCOUNT);
  assert.equal(parsed.corrupted, true);
  assert.deepEqual(parsed.items.map((item) => item.id), [uuid(1), uuid(3)]);
  const result = await outbox.replay(ACCOUNT, handlers);
  assert.deepEqual(result.synced.map((item) => item.id), [uuid(1), uuid(3)]);
  assert.deepEqual(calls, [`checkin:${uuid(1)}`, `journal:${uuid(3)}`]);
});

test('accounts are isolated: one account never replays, lists, or clears another account\'s queue', async () => {
  const storage = new MemoryStorage();
  const outbox = createOfflineOutbox(storage);
  await outbox.enqueue(ACCOUNT, checkin(1));
  await outbox.enqueue(OTHER, checkin(2, OTHER));

  // A record written under account A's key but stamped for account B is not trusted.
  storage.values.set(outboxKeyFor('account-c'), JSON.stringify({ version: 1, accountId: ACCOUNT, items: [checkin(3)] }));
  assert.deepEqual(await outbox.list('account-c'), []);

  const { calls, handlers } = recordingHandlers();
  await outbox.replay(ACCOUNT, handlers);
  assert.deepEqual(calls, [`checkin:${uuid(1)}`]);
  assert.deepEqual((await outbox.list(OTHER)).map((item) => item.id), [uuid(2)]);

  await outbox.clear(OTHER);
  assert.deepEqual(await outbox.list(OTHER), []);
  assert.deepEqual(await outbox.list(''), []);
});

test('enqueue during replay is serialized and survives the replay rewrite', async () => {
  const storage = new MemoryStorage();
  const outbox = createOfflineOutbox(storage);
  await outbox.enqueue(ACCOUNT, checkin(1));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const handlers: OutboxHandlers = { async checkin() { await gate; }, async journal() {} };
  const replay = outbox.replay(ACCOUNT, handlers);
  const enqueue = outbox.enqueue(ACCOUNT, journal(2));
  release();
  await replay;
  assert.equal(await enqueue, true);
  assert.deepEqual((await outbox.list(ACCOUNT)).map((item) => item.id), [uuid(2)]);
});

test('replay events reach subscribers only when something changed', () => {
  const seen: string[] = [];
  const unsubscribe = subscribeOutboxReplay(({ accountId, result }) => seen.push(`${accountId}:${result.synced.length}`));
  emitOutboxReplay(ACCOUNT, { synced: [], dropped: [], remaining: [checkin(1)] });
  emitOutboxReplay(ACCOUNT, { synced: [checkin(1)], dropped: [], remaining: [] });
  unsubscribe();
  emitOutboxReplay(ACCOUNT, { synced: [checkin(2)], dropped: [], remaining: [] });
  assert.deepEqual(seen, [`${ACCOUNT}:1`]);
});
