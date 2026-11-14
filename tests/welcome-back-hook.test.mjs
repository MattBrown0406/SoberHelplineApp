import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

// Runs the real useWelcomeBack with small React / AppState / storage doubles.
const root = path.resolve(import.meta.dirname, '..');
const WEEK = 7 * 86_400_000;
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function mount({ last = null } = {}) {
  const slots = [], effects = [], listeners = [];
  let cursor = 0, api;
  const store = new Map(last ? [['key:a', last]] : []);
  const io = { reads: 0, writes: 0, gate: null };
  const appState = {
    currentState: 'active',
    addEventListener(_, fn) { listeners.push(fn); return { remove() { listeners.splice(listeners.indexOf(fn), 1); } }; },
  };
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (next) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn) { cursor++; return fn; },
    useEffect(fn, deps) { const i = cursor++; const old = slots[i]; if (!old || deps.some((dep, j) => dep !== old.deps[j])) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const mocks = {
    react,
    'react-native': { AppState: appState },
    '@react-native-async-storage/async-storage': { default: {
      async getItem(key) { io.reads += 1; if (io.gate) await io.gate.promise; return store.get(key) ?? null; },
      async setItem(key, value) { io.writes += 1; store.set(key, value); },
    } },
    '../lib/welcomeBack': {
      lastOpenedStorageKey: (id) => `key:${id}`,
      isReturnAfterAbsence: (then, now) => !!then && now.getTime() - Date.parse(then) >= WEEK,
    },
  };
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(root, 'src/hooks/useWelcomeBack.ts'), 'utf8');
  vm.runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: (id) => { assert.ok(id in mocks, `missing mock ${id}`); return mocks[id]; }, Date, Promise },
  );
  const render = () => { cursor = 0; api = module.exports.useWelcomeBack('a'); effects.splice(0).forEach((run) => run()); return api; };
  return {
    io, store, render,
    get api() { return api; },
    emit(state) { appState.currentState = state; for (const fn of [...listeners]) fn(state); },
    /** The app's state has changed, but this hook's own listener has not been called yet. */
    setStateOnly(state) { appState.currentState = state; },
    setLast(iso) { store.set('key:a', iso); },
  };
}
const longAgo = () => new Date(Date.now() - 8 * 86_400_000).toISOString();

test('decided() waits for the welcome-back look, so nothing acts a moment before the card', async () => {
  const hook = mount({ last: new Date().toISOString() });
  hook.render(); await settle(); hook.render();
  assert.equal(hook.api.ready, true); assert.equal(hook.api.returned, false);
  // A week in the background, then back in front. Storage is slow.
  hook.emit('background'); hook.setLast(longAgo()); hook.io.gate = deferred();
  hook.emit('active');
  let answer = 'pending';
  void hook.api.decided().then((value) => { answer = value; });
  await settle();
  assert.equal(answer, 'pending', 'still looking: the reminder ask must wait, not show');
  hook.io.gate.resolve(); await settle(); hook.render();
  assert.equal(answer, true); assert.equal(hook.api.visible, true); assert.equal(hook.api.returned, true);
});

test('decided() starts the look itself if it is asked before the app-state listener ran', async () => {
  const hook = mount({ last: new Date().toISOString() });
  hook.render(); await settle();
  hook.emit('background'); hook.setLast(longAgo());
  const reads = hook.io.reads;
  // The app is in front again and another listener (the reminder ask) got there first.
  hook.setStateOnly('active');
  const asked = hook.api.decided();
  hook.emit('active'); // then the hook's own listener
  assert.equal(await asked, true);
  assert.equal(hook.io.reads, reads + 1, 'one look for this time in front, shared by both');
});

test('"returned" lasts for the visit, not for the whole run of the app', async () => {
  const hook = mount({ last: longAgo() });
  hook.render(); await settle(); hook.render();
  assert.equal(hook.api.visible, true); assert.equal(hook.api.returned, true);
  // Dismissed: the card goes, but this visit still does not get a second ask.
  hook.api.dismiss(); hook.render();
  assert.equal(hook.api.visible, false); assert.equal(hook.api.returned, true);
  assert.equal(await hook.api.decided(), true);
  // The visit ends; the next one is an ordinary visit again.
  hook.emit('background'); hook.render();
  assert.equal(hook.api.returned, false);
  hook.emit('active'); await settle(); hook.render();
  assert.equal(hook.api.returned, false); assert.equal(hook.api.visible, false);
  assert.equal(await hook.api.decided(), false);
});

test('a card she has not dismissed keeps holding other asks back across visits', async () => {
  const hook = mount({ last: longAgo() });
  hook.render(); await settle(); hook.render();
  hook.emit('background'); hook.render();
  assert.equal(hook.api.visible, true);
  assert.equal(hook.api.returned, true, 'still on screen, so still "returned" for Today');
  hook.emit('active'); await settle();
  assert.equal(await hook.api.decided(), true);
});

test('nothing looks (or writes "last opened") while the app is in the background', async () => {
  const hook = mount({ last: new Date().toISOString() });
  hook.render(); await settle();
  const { reads, writes } = hook.io;
  hook.emit('background');
  assert.equal(await hook.api.decided(), false);
  assert.equal(hook.io.reads, reads); assert.equal(hook.io.writes, writes);
  // A system sheet passing over is not a new visit: no second look either.
  hook.emit('active'); await settle();
  hook.emit('inactive'); hook.emit('active'); await settle();
  assert.equal(hook.io.reads, reads + 1); assert.equal(hook.io.writes, writes + 1);
});
