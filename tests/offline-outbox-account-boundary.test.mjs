import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';

// Execute BOTH actual modules. IO and React scheduling are deterministic doubles,
// not rendered/native tests. Baseline mode never swaps shared-worktree files.
const root = path.resolve(import.meta.dirname, '..');
const source = p => process.env.OUTBOX_BASELINE_REF
  ? execFileSync('git', ['show', `${process.env.OUTBOX_BASELINE_REF}:${p}`], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(path.join(root, p), 'utf8');
function load(p, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source(p), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: id => { assert.ok(id in mocks, id); return mocks[id]; }, console, Date, setTimeout, clearTimeout });
  return module.exports;
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
function fixture() {
  const values = new Map(), listeners = new Set(), appListeners = new Set(), calls = [], events = [], errors = [];
  let identity = 'A', token = 'token-A', readGate, writeGate, insert = async () => ({ error: null }), sessionGate, accountGate;
  const session = () => identity ? { user: { id: `auth-${identity}` }, access_token: token, expires_at: Date.now() / 1000 + 3600 } : null;
  const storage = {
    async getItem(k) { if (readGate) { const g = readGate; readGate = null; await g.promise; } return values.get(k) ?? null; },
    async setItem(k, v) { if (writeGate) { const g = writeGate; writeGate = null; await g.promise; } values.set(k, v); },
    async removeItem(k) { values.delete(k); },
  };
  const lib = load('src/lib/offlineOutbox.ts', { '@react-native-async-storage/async-storage': { default: storage }, './offlineAccountCache': { isOfflineFallbackError: () => false } });
  lib.subscribeOutboxReplay(e => events.push(e));
  const auth = {
    async getSession() { const captured = session(); if (sessionGate) { const g = sessionGate; sessionGate = null; await g.promise; } return { data: { session: captured }, error: null }; },
    onAuthStateChange(fn) { listeners.add(fn); return { data: { subscription: { unsubscribe: () => listeners.delete(fn) } } }; },
  };
  const supabase = { auth, from(table) {
    const headers = {}, filters = {}; let payload;
    const query = {
      select() { return query; }, eq(k, v) { filters[k] = v; return query; }, maybeSingle() { return query; }, single() { return query; },
      insert(p) { payload = p; return query; }, setHeader(k, v) { headers[k] = v; return query; },
      then(resolve, reject) { return (async () => {
        if (table === 'accounts') { if (accountGate) { const g = accountGate; accountGate = null; await g.promise; } return { data: filters.id === `account-${identity}` && filters.user_id === `auth-${identity}` ? { id: filters.id } : null, error: null }; }
        const call = { table, payload, authorization: headers.Authorization ?? `Bearer ${token}` }; calls.push(call);
        return insert(call, calls.length);
      })().then(resolve, reject); },
    }; return query;
  } };
  const slots = []; let cursor = 0; const pendingEffects = [];
  const react = {
    useRef(v) { return slots[cursor++] ??= { current: v }; },
    useCallback(fn, deps) { const n = cursor++, old = slots[n]; if (!old || deps.some((d, i) => d !== old.deps[i])) slots[n] = { deps, fn }; return slots[n].fn; },
    useEffect(fn, deps) { const n = cursor++, old = slots[n]; if (!old || deps.some((d, i) => d !== old.deps[i])) pendingEffects.push(() => { old?.cleanup?.(); slots[n] = { deps, cleanup: fn() }; }); },
  };
  const hook = load('src/hooks/useOfflineOutbox.ts', { react, 'react-native': { AppState: { addEventListener(_, fn) { appListeners.add(fn); return { remove: () => appListeners.delete(fn) }; } } }, '../lib/supabase': { supabase }, '../lib/offlineOutbox': lib, '../lib/monitoring': { addAppBreadcrumb() {}, captureAppError: e => errors.push(e) } });
  const item = (n, kind = 'checkin') => {
    const id = `11111111-1111-4111-8111-${String(n).padStart(12, '0')}`, date = '2026-10-01T12:00:00.000Z';
    return { id, kind, queuedAt: date, payload: kind === 'checkin'
      ? { id, account_id: 'account-A', mood: 3, capacity: null, pressure: null, support_need: null, note: null, created_at: date, checkin_date: '2026-10-01' }
      : { id, account_id: 'account-A', family_space_id: 'family-A', note: 'private A', created_at: date } };
  };
  return { lib, hook, calls, events, errors, listeners, appListeners, values, item,
    async seed(secondKind = 'journal') { await lib.offlineOutbox.enqueue('account-A', item(1)); await lib.offlineOutbox.enqueue('account-A', item(2, secondKind)); },
    switch(next, event = next ? 'SIGNED_IN' : 'SIGNED_OUT') { identity = next; token = `token-${next}`; for (const fn of [...listeners]) fn(event, session()); },
    refresh() { token = 'token-A-refreshed'; for (const fn of [...listeners]) fn('TOKEN_REFRESHED', session()); },
    setInsert(fn) { insert = fn; }, delayRead(g) { readGate = g; }, delayWrite(g) { writeGate = g; }, delaySession(g) { sessionGate = g; }, delayAccount(g) { accountGate = g; },
    render(id = 'account-A', effects = true) { cursor = 0; hook.useOfflineOutbox(id); if (effects) pendingEffects.splice(0).forEach(fn => fn()); },
    unmount() { slots.forEach(s => s?.cleanup?.()); },
  };
}
const counts = r => [r.synced.length, r.dropped.length, r.remaining.length];
test('switch after first accepted insert: 1 synced, 0 dropped, 1 preserved; never send A as B', async () => {
  const x = fixture(); await x.seed('checkin'); x.setInsert(async (_, n) => { if (n === 1) x.switch('B'); return n === 1 ? { error: null } : { error: { code: '42501' } }; });
  const result = await x.hook.replayOfflineOutbox('account-A');
  assert.deepEqual(counts(result), [1, 0, 1]); assert.equal(x.calls.length, 1); assert.equal((await x.lib.offlineOutbox.list('account-A')).length, 1); assert.equal(x.events.length, 0);
});
for (const where of ['read', 'session', 'account']) test(`switch during ${where} wait preserves every item`, async () => {
  const x = fixture(); await x.seed(); const gate = deferred(); x[`delay${where[0].toUpperCase()}${where.slice(1)}`](gate);
  const p = x.hook.replayOfflineOutbox('account-A'); await settle(); x.switch('B'); gate.resolve(); const r = await p;
  assert.equal(x.calls.length, 0); assert.deepEqual(counts(r), [0, 0, 2]); assert.equal((await x.lib.offlineOutbox.list('account-A')).length, 2);
});
test('already wrong account at startup is retained, not classified as RLS failure', async () => {
  const x = fixture(); await x.seed(); x.switch('B'); x.setInsert(async () => ({ error: { code: '42501' } }));
  assert.deepEqual(counts(await x.hook.replayOfflineOutbox('account-A')), [0, 0, 2]); assert.equal(x.calls.length, 0);
});
for (const failure of ['returned', 'thrown', 'duplicate']) test(`${failure} completion after A-B-A preserves unconfirmed work`, async () => {
  const x = fixture(); await x.seed(); const gate = deferred(); x.setInsert(async () => { await gate.promise; if (failure === 'thrown') throw { code: '42501' }; return { error: { code: failure === 'duplicate' ? '23505' : '42501' } }; });
  const p = x.hook.replayOfflineOutbox('account-A'); await settle(); assert.equal(x.calls.length, 1); x.switch('B'); x.switch('A'); gate.resolve();
  assert.deepEqual(counts(await p), [0, 0, 2]); assert.equal(x.calls.length, 1);
});
test('same-account token refresh continues, pins fresh token on next insert', async () => {
  const x = fixture(); await x.seed(); x.setInsert(async (_, n) => { if (n === 1) x.refresh(); return { error: null }; });
  assert.deepEqual(counts(await x.hook.replayOfflineOutbox('account-A')), [2, 0, 0]);
  assert.deepEqual(x.calls.map(c => c.authorization), ['Bearer token-A', 'Bearer token-A-refreshed']); assert.equal(x.events.length, 1); assert.equal(x.listeners.size, 0);
});
test('genuine same-lifetime unique violation stays idempotently synced, permanent failure stays dropped', async () => {
  const x = fixture(); await x.seed(); x.setInsert(async (_, n) => ({ error: { code: n === 1 ? '23505' : '42501' } }));
  assert.deepEqual(counts(await x.hook.replayOfflineOutbox('account-A')), [1, 1, 0]);
});
for (const why of ['unmount', 'account-render', 'account-A-B-A']) test(`${why} disables retained callbacks and delayed inserts`, async () => {
  const x = fixture(); await x.seed(); const gate = deferred(); x.delayRead(gate); x.render(); await settle();
  const oldApp = [...x.appListeners][0], oldAuth = [...x.listeners];
  if (why === 'unmount') x.unmount(); else { x.render('account-B', false); if (why === 'account-A-B-A') x.render('account-A', false); }
  gate.resolve(); await settle(); oldApp('active'); oldAuth.forEach(fn => fn('TOKEN_REFRESHED', { user: { id: 'auth-A' } })); await settle();
  assert.equal(x.calls.length, 0); assert.equal(x.events.length, 0); assert.equal((await x.lib.offlineOutbox.list('account-A')).length, 2); x.unmount();
});
test('accepted in-flight insert survives unmount but does not emit or continue', async () => {
  const x = fixture(); await x.seed(); const gate = deferred(); x.setInsert(async () => { await gate.promise; return { error: null }; }); x.render(); await settle(); assert.equal(x.calls.length, 1);
  x.unmount(); gate.resolve(); await settle(); assert.equal(x.calls.length, 1); assert.equal((await x.lib.offlineOutbox.list('account-A')).length, 1); assert.equal(x.events.length, 0);
});
test('identity switch during result persistence suppresses stale notification', async () => {
  const x = fixture(); await x.seed(); const gate = deferred(); x.delayWrite(gate); x.setInsert(async (_, n) => ({ error: n === 2 ? { code: '401' } : null }));
  const p = x.hook.replayOfflineOutbox('account-A'); await settle(); x.switch('B'); gate.resolve(); assert.deepEqual(counts(await p), [1, 0, 1]); assert.equal(x.events.length, 0);
});
test('switch while failure classification revalidates cannot drop RLS-denied work', async () => {
  const x = fixture(); await x.seed(); const gate = deferred();
  x.setInsert(async () => { x.delaySession(gate); return { error: { code: '42501' } }; });
  const p = x.hook.replayOfflineOutbox('account-A'); await settle(); x.switch('B'); gate.resolve();
  assert.deepEqual(counts(await p), [0, 0, 2]); assert.equal(x.calls.length, 1);
});
test('same-account refresh during storage wait remains replayable', async () => {
  const x = fixture(); await x.seed(); const gate = deferred(); x.delayRead(gate);
  const p = x.hook.replayOfflineOutbox('account-A'); await settle(); x.refresh(); gate.resolve();
  assert.deepEqual(counts(await p), [2, 0, 0]); assert.ok(x.calls.every(c => c.authorization === 'Bearer token-A-refreshed'));
});
test('serialized replay waiting behind another storage edit rechecks owner', async () => {
  const x = fixture(); await x.seed(); const gate = deferred(); x.delayWrite(gate);
  const edit = x.lib.offlineOutbox.enqueue('account-A', x.item(3)); await settle();
  const p = x.hook.replayOfflineOutbox('account-A'); await settle(); x.switch('B'); gate.resolve(); await edit;
  assert.deepEqual(counts(await p), [0, 0, 3]); assert.equal(x.calls.length, 0);
});
test('unknown acceptance retains stable IDs; later duplicate acknowledgment drains once', async () => {
  const x = fixture(); await x.seed(); x.setInsert(async () => { throw new Error('response lost'); });
  assert.deepEqual(counts(await x.hook.replayOfflineOutbox('account-A')), [0, 0, 2]);
  x.setInsert(async (_, n) => ({ error: n === 2 ? { code: '23505' } : null }));
  assert.deepEqual(counts(await x.hook.replayOfflineOutbox('account-A')), [2, 0, 0]);
  assert.equal(x.calls[0].payload.id, x.calls[1].payload.id);
});
test('signed-out startup accurately reports preserved pending work', async () => {
  const x = fixture(); await x.seed(); x.switch(null);
  assert.deepEqual(counts(await x.hook.replayOfflineOutbox('account-A')), [0, 0, 2]); assert.equal(x.calls.length, 0);
});
test('installed Supabase request setHeader really pins Authorization across async token lookup', async () => {
  const gate = deferred(), captured = []; let token = 'token-A';
  const client = createClient('https://outbox-test.invalid', 'public-test', { accessToken: async () => { await gate.promise; return token; }, global: { fetch: async (_, init) => { captured.push(new Headers(init.headers).get('Authorization')); return new Response(null, { status: 201 }); } } });
  const request = Promise.resolve(client.from('checkins').insert({ id: 'test' }).setHeader('Authorization', 'Bearer token-A'));
  await settle(); token = 'token-B'; gate.resolve(); assert.equal((await request).error, null); assert.deepEqual(captured, ['Bearer token-A']);
});
