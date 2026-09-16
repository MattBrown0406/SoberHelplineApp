import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Runs the real useCheckIn hook against an unreachable Supabase double and
// asserts a signed-in check-in lands in the outbox instead of failing.
function harness() {
  const slots = []; let index = 0; let effects = []; let renderFn;
  const equal = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const react = {
    useState(initial) {
      const i = index++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (v) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }];
    },
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
    useCallback(fn, deps) {
      const i = index++; if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { fn, deps }; return slots[i].fn;
    },
    useEffect(fn, deps) {
      const i = index++;
      if (!slots[i] || !equal(slots[i].deps, deps)) {
        const old = slots[i]; slots[i] = { deps, cleanup: old?.cleanup };
        effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
  return {
    react,
    render(fn = renderFn) { renderFn = fn; index = 0; return fn(); },
    effects() { const pending = effects; effects = []; pending.forEach((fn) => fn()); },
  };
}
function load(path, mocks = {}) {
  const file = new URL(`../${path}`, import.meta.url);
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports, require(id) {
      if (!(id in mocks)) throw new Error(`Unexpected dependency: ${id}`);
      return mocks[id];
    }, console, setTimeout, clearTimeout, Intl, Date, Number, JSON, Map, Set, Promise, Error, TypeError, Array, Object, String, RegExp,
  }, { filename: file.pathname });
  return module.exports;
}
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const memory = () => {
  const values = new Map();
  return {
    values,
    async getItem(key) { return values.get(key) ?? null; },
    async setItem(key, value) { values.set(key, value); },
    async removeItem(key) { values.delete(key); },
    async getAllKeys() { return [...values.keys()]; },
  };
};

function fixture({ online }) {
  const h = harness();
  const storage = memory();
  const inserts = [];
  const monitoring = { captureAppError() {}, addAppBreadcrumb() {} };
  const offlineAccountCache = load('src/lib/offlineAccountCache.ts', {
    '@react-native-async-storage/async-storage': { default: storage },
    './featureAccess': { entitlementsForAccountState: () => ({}) },
  });
  const outbox = load('src/lib/offlineOutbox.ts', {
    '@react-native-async-storage/async-storage': { default: storage },
    './offlineAccountCache': offlineAccountCache,
  });
  const supabase = { from: (table) => ({
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: online ? null : new TypeError('Network request failed') }) }), order: async () => ({ data: online ? [] : null, error: online ? null : new TypeError('Network request failed') }) }) }),
    insert: (row) => { inserts.push({ table, row }); return { select: () => ({ single: async () => online
      ? { data: { id: row.id, mood: row.mood, capacity: row.capacity, pressure: row.pressure, support_need: row.support_need, note: row.note, created_at: row.created_at }, error: null }
      : { data: null, error: new TypeError('Network request failed') } }) }; },
  }) };
  const { useCheckIn } = load('src/hooks/useCheckIn.ts', {
    react: h.react,
    'expo-crypto': { randomUUID: () => '11111111-2222-4333-8444-555555555555' },
    '../api/types': {},
    '../storage/checkIn': load('src/storage/checkIn.ts', { '@react-native-async-storage/async-storage': { default: storage } }),
    '../lib/supabase': { supabase },
    '../lib/checkInPersistence': load('src/lib/checkInPersistence.ts'),
    '../lib/monitoring': monitoring,
    '../lib/caregiverCheckIn': load('src/lib/caregiverCheckIn.ts'),
    './usePushNotifications': { rearmDailyNudge: async () => {} },
    '../lib/offlineOutbox': outbox,
  });
  const read = () => h.render(() => useCheckIn('account-a', 'UTC'));
  read(); h.effects();
  return { read, h, storage, inserts, outbox };
}

const input = { moodScore: 2, capacityScore: 3, pressureScore: 4, supportNeed: 'rest', note: ' hard day ' };

test('an offline signed-in check-in is queued, counted toward the streak, and shown as pending sync', async () => {
  const f = fixture({ online: false });
  await settle();
  const streak = await f.read().saveCheckIn(input);
  assert.equal(streak.currentStreak, 1);
  const state = f.read();
  assert.equal(state.pendingSync, true);
  assert.equal(state.todayCheckIn.note, 'hard day');
  assert.equal(state.todayCheckIn.synced, false);
  const queued = await f.outbox.offlineOutbox.list('account-a');
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, 'checkin');
  assert.equal(queued[0].payload.account_id, 'account-a');
  assert.equal(queued[0].payload.created_at, state.todayCheckIn.completedAt);
  assert.equal(f.inserts.length, 1);
});

test('a replayed check-in flips the displayed check-in to synced', async () => {
  const f = fixture({ online: false });
  await settle();
  await f.read().saveCheckIn(input);
  f.read(); f.h.effects();
  const synced = [];
  await f.outbox.offlineOutbox.replay('account-a', { async checkin(payload) { synced.push(payload); }, async journal() {} })
    .then((result) => f.outbox.emitOutboxReplay('account-a', result));
  await settle();
  const state = f.read();
  assert.equal(synced.length, 1);
  assert.equal(state.pendingSync, false);
  assert.equal(state.todayCheckIn.synced, true);
  assert.equal((await f.outbox.offlineOutbox.list('account-a')).length, 0);
});

test('an online check-in never touches the outbox', async () => {
  const f = fixture({ online: true });
  await settle();
  await f.read().saveCheckIn(input);
  assert.equal(f.read().pendingSync, false);
  assert.equal((await f.outbox.offlineOutbox.list('account-a')).length, 0);
});
