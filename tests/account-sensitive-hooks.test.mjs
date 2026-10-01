import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

// Actual transpiled hook modules; deterministic scheduling/IO, not device UI.
function harness() {
  const slots = []; let cursor = 0; let effects = [];
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) { const old = slots[i]; slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  return {
    react,
    read(fn) { cursor = 0; return fn(); },
    async flush(fn) { for (let i = 0; i < 30; i++) { this.read(fn); const p = effects; effects = []; p.forEach(f => f()); await Promise.resolve(); } return this.read(fn); },
    unmount() { slots.forEach(s => s?.cleanup?.()); },
  };
}
function load(file, mocks) {
  const module = { exports: {} };
  const source = process.env.AUDIT_BASELINE_REF && file !== 'src/hooks/useAsyncScope.ts'
    ? execFileSync('git', ['show', `${process.env.AUDIT_BASELINE_REF}:${file}`], { encoding: 'utf8' })
    : fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports: module.exports, require(id) { assert.ok(id in mocks, id); return mocks[id]; }, console,
  });
  return module.exports;
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const appState = { addEventListener() { return { remove() {} }; } };
const message = owner => ({ id: `m-${owner}`, body: `PRIVATE-${owner}`, sender_role: 'member', created_at: '2026-10-01T00:00:00Z' });
function chatFixture() {
  const h = harness(); let owner = 'A'; let enabled = true; const subscriptions = []; const calls = [];
  let heldHistory = null; let heldSend = null;
  const supabase = {
    from(table) {
      const principal = owner; let payload; const chain = {};
      for (const name of ['select', 'eq', 'is', 'order', 'limit', 'in']) chain[name] = () => chain;
      chain.insert = value => { payload = value; calls.push({ table, payload, principal }); return chain; };
      chain.maybeSingle = async () => ({ data: { id: `thread-${principal}` }, error: null });
      chain.single = async () => heldSend ? heldSend.promise : ({ data: message(principal), error: null });
      chain.then = (resolve, reject) => (table === 'messages' && heldHistory ? heldHistory.promise : Promise.resolve({ data: table === 'messages' ? [message(principal)] : [], error: null })).then(resolve, reject);
      return chain;
    },
    channel() { const handlers = []; subscriptions.push(handlers); return { on(_, filter, fn) { handlers.push({ ...filter, fn }); return this; }, subscribe() { return this; } }; },
    removeChannel() {},
    rpc: async (name, args) => { calls.push({ name, args }); return { error: null }; },
  };
  const { useThread } = load('src/hooks/useThread.ts', {
    react: h.react, 'react-native': { AppState: appState }, 'expo-file-system/legacy': {},
    '../lib/supabase': { supabase }, '../lib/realtimeTopics': { threadChannelTopic: () => 'test' },
    './useAsyncScope': load('src/hooks/useAsyncScope.ts', { react: h.react }),
  });
  const render = () => useThread(owner, enabled);
  return { read: () => h.read(render), flush: () => h.flush(render), unmount: () => h.unmount(), calls, subscriptions,
    switchTo(value) { owner = value; }, disable() { enabled = false; }, holdHistory(d) { heldHistory = d; }, holdSend(d) { heldSend = d; } };
}

test('chat hides account A immediately on B render, then only shows B history', async () => {
  const f = chatFixture(); await f.flush(); const old = f.read();
  assert.equal(old.messages[0].body, 'PRIVATE-A');
  f.switchTo('B'); assert.equal(f.read().messages.length, 0); assert.equal(f.read().threadId, null);
  await assert.rejects(old.send('old private draft'), /thread_unavailable/);
  assert.equal(f.calls.length, 0);
  await f.flush(); assert.equal(f.read().messages[0].body, 'PRIVATE-B');
  f.disable(); assert.equal(f.read().messages.length, 0); await f.flush(); f.unmount();
});

test('late chat history and removed realtime callbacks cannot repopulate another account', async () => {
  const f = chatFixture(); const held = deferred(); f.holdHistory(held); await f.flush();
  f.switchTo('B'); f.holdHistory(null); await f.flush();
  held.resolve({ data: [message('A')], error: null }); await f.flush();
  assert.equal(f.read().messages[0].body, 'PRIVATE-B'); f.unmount();
  const g = chatFixture(); await g.flush(); const oldHandlers = g.subscriptions[0];
  g.switchTo('B'); await g.flush();
  oldHandlers.find(x => x.table === 'messages').fn({ new: message('A') });
  assert.equal(g.read().messages.length, 1); assert.equal(g.read().messages[0].body, 'PRIVATE-B'); g.unmount();
});

test('a late chat send does not publish private text or start attachments after account switch', async () => {
  const f = chatFixture(); await f.flush(); const held = deferred(); f.holdSend(held);
  const sent = f.read().send('private draft A', [{ uri: 'file://private-A', fileName: 'a.jpg', mimeType: 'image/jpeg' }]);
  f.switchTo('B'); await f.flush();
  held.resolve({ data: message('A'), error: null }); await sent;
  assert.equal(f.read().messages.length, 1); assert.equal(f.read().messages[0].body, 'PRIVATE-B');
  assert.equal(f.read().sending, false); f.unmount();
});

function videoFixture() {
  const h = harness(); let owner = 'A'; let access = true; let heldLoad = null; let heldMutation = null; let heldCheckout = null;
  const calls = [];
  const row = principal => ({ id: `session-${principal}`, account_id: principal, member_note: `PRIVATE-${principal}` });
  const supabase = {
    rpc: async (name, args) => {
      calls.push({ name, args, owner });
      if (name === 'member_get_active_video_session') return heldLoad ? heldLoad.promise : { data: [row(owner)], error: null };
      if (name === 'member_get_video_session_history') return { data: [], error: null };
      return heldMutation ? heldMutation.promise : { data: row(owner), error: null };
    },
    functions: { invoke: async () => heldCheckout ? heldCheckout.promise : { data: { ok: true, checkout_url: 'https://example.invalid/checkout' }, error: null } },
    from() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null, error: null }) }; },
    channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {},
  };
  const { usePrivateVideoSessions } = load('src/hooks/usePrivateVideoSessions.ts', {
    react: h.react, 'react-native': { AppState: appState }, '../lib/supabase': { supabase },
    '../lib/realtimeTopics': { privateVideoChannelTopic: () => 'test' }, '../lib/videoErrors': { videoErrorCode: () => 'unknown' },
    './useAsyncScope': load('src/hooks/useAsyncScope.ts', { react: h.react }),
  });
  const render = () => usePrivateVideoSessions(owner, access);
  return { read: () => h.read(render), flush: () => h.flush(render), unmount: () => h.unmount(), calls,
    switchTo(v) { owner = v; }, disable() { access = false; }, holdLoad(d) { heldLoad = d; }, holdMutation(d) { heldMutation = d; }, holdCheckout(d) { heldCheckout = d; } };
}

test('appointments hide A on first B render and stale callbacks issue no RPC', async () => {
  const f = videoFixture(); await f.flush(); const old = f.read(); assert.equal(old.activeSession.account_id, 'A');
  f.switchTo('B'); assert.equal(f.read().activeSession, null); assert.equal(f.read().history.length, 0);
  const count = f.calls.length;
  await old.load(); assert.equal(await old.cancelSession(old.activeSession), null);
  assert.equal(f.calls.length, count);
  await f.flush(); assert.equal(f.read().activeSession.account_id, 'B');
  f.disable(); assert.equal(f.read().activeSession, null); await f.flush(); f.unmount();
});

test('late appointment mutation cannot reload into or change the next account', async () => {
  const f = videoFixture(); await f.flush(); const held = deferred(); f.holdMutation(held);
  const operation = f.read().cancelSession(f.read().activeSession);
  f.switchTo('B'); await f.flush(); const count = f.calls.length;
  held.resolve({ data: { account_id: 'A' }, error: null });
  assert.equal(await operation, null); assert.equal(f.calls.length, count);
  assert.equal(f.read().activeSession.account_id, 'B'); assert.equal(f.read().mutating, false); f.unmount();
});

test('appointment network rejections settle loading, mutation and checkout states with retryable errors', async () => {
  const f = videoFixture(); await f.flush();
  const read = deferred(); f.holdLoad(read); const loading = f.read().load();
  read.reject(new Error('offline'));
  await assert.doesNotReject(loading); assert.equal(f.read().loading, false); assert.equal(f.read().errorKey, 'unknown');
  f.holdLoad(null); await f.read().load(); assert.equal(f.read().errorKey, null);
  const mutation = deferred(); f.holdMutation(mutation); const cancelling = f.read().cancelSession(f.read().activeSession);
  mutation.reject(new Error('offline'));
  assert.equal(await cancelling, null); assert.equal(f.read().mutating, false); assert.equal(f.read().errorKey, 'unknown');
  const checkout = deferred(); f.holdCheckout(checkout); const paying = f.read().beginPlanReviewCheckout(f.read().activeSession);
  checkout.reject(new Error('offline'));
  assert.equal(await paying, null); assert.equal(f.read().mutating, false); assert.equal(f.read().errorKey, 'checkout_unavailable');
  f.unmount();
});

test('late checkout URL and post-unmount refresh are discarded', async () => {
  const f = videoFixture(); await f.flush(); const held = deferred(); f.holdCheckout(held);
  const checkout = f.read().beginPlanReviewCheckout(f.read().activeSession);
  f.switchTo('B'); await f.flush();
  held.resolve({ data: { ok: true, checkout_url: 'https://example.invalid/private-A' }, error: null });
  assert.equal(await checkout, null); assert.equal(f.read().mutating, false);
  const old = f.read(); f.unmount(); const count = f.calls.length;
  await old.load(); assert.equal(f.calls.length, count);
});
