import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Audit round 3 (app side), before sign-in: runs the real source with small
// doubles for the device store and React Native.
const root = new URL('../', import.meta.url);
const source = (path) => fs.readFileSync(new URL(path, root), 'utf8');
function load(path, imports = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: (id) => {
    if (id in imports) return imports[id];
    throw Error(`Unexpected import ${id}`);
  }, Date, Intl, console, Promise, setTimeout, clearTimeout, ...globals });
  return module.exports;
}
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const plain = (value) => JSON.parse(JSON.stringify(value));

// ── M4: the flags as they are now, and one try per return ───────────────────

test('M4: a sign-up sent this run is known at once, without waiting for storage', async () => {
  const writes = [];
  const store = load('src/lib/frontDoorStore.ts', {
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async () => null, getAllKeys: async () => [], setItem: async (key, value) => { writes.push([key, value]); } } },
    './frontDoor': load('src/lib/frontDoor.ts'),
  });
  assert.deepEqual(plain(store.knownFrontDoorFlags()), { signedInBefore: false, signUpSubmitted: false }, 'not read yet is "never"');
  assert.deepEqual(plain(await store.readFrontDoorFlags()), { signedInBefore: false, signUpSubmitted: false });
  store.markSignUpSubmitted();
  assert.deepEqual(plain(store.knownFrontDoorFlags()), { signedInBefore: false, signUpSubmitted: true });
  store.markSignedInBefore();
  assert.deepEqual(plain(store.knownFrontDoorFlags()), { signedInBefore: true, signUpSubmitted: true });
  // Still only the two bare flags on the device.
  assert.deepEqual(writes, [['@sh:front-door:sign-up-submitted', '1'], ['@sh:front-door:signed-in-before', '1']]);
});

// The confirm step's own effect, lifted from the component and run with doubles.
function confirmStep({ password = 'typed-password', now = 1_000_000 } = {}) {
  const panel = source('src/components/auth/ConfirmEmailPanel.tsx');
  const body = /useEffect\((\(\) => \{\s+let wasBackgrounded = false;[\s\S]*?\n  \}), \[\]\);/.exec(panel)?.[1];
  assert.ok(body, 'the return effect is where it was');
  const frontDoor = load('src/lib/frontDoor.ts');
  const state = { now, tries: 0, forgotten: 0, notices: [], appState: null, link: null, timers: [] };
  const scope = {
    AppState: { addEventListener: (_, listener) => { state.appState = listener; return { remove() { state.appState = null; } }; } },
    subscribeLinkWhileHeld: (listener) => { state.link = listener; return () => { state.link = null; }; },
    passwordRef: { current: password }, busyRef: { current: false }, mounted: { current: true },
    forgetRef: { current: () => { state.forgotten += 1; scope.passwordRef.current = ''; } },
    trySignIn: { current: async () => { state.tries += 1; } },
    setNotice: (notice) => state.notices.push(notice),
    shouldForgetPassword: frontDoor.shouldForgetPassword, shouldAutoTryOnReturn: frontDoor.shouldAutoTryOnReturn,
    PASSWORD_MEMORY_BACKGROUND_LIMIT_MS: frontDoor.PASSWORD_MEMORY_BACKGROUND_LIMIT_MS,
    Date: { now: () => state.now }, setTimeout: (fn) => { state.timers.push(fn); return state.timers.length; }, clearTimeout() {},
  };
  const effect = new Function(...Object.keys(scope), `${ts.transpile(`const effect = ${body};`, { target: ts.ScriptTarget.ES2022 })}\nreturn effect;`)(...Object.values(scope));
  const cleanup = effect();
  return { state, scope, cleanup, away(ms) { state.appState('background'); state.now += ms; } };
}

test('M4: the "open the app" link and the app coming forward are one return and one sign-in try', () => {
  // The usual order: the app comes forward, then the link is delivered.
  const a = confirmStep();
  a.away(20_000); a.state.appState('active'); a.state.now += 40; a.state.link();
  assert.equal(a.state.tries, 1);
  // The other order: the link first.
  const b = confirmStep();
  b.away(20_000); b.state.link(); b.state.now += 40; b.state.appState('inactive'); b.state.appState('active');
  assert.equal(b.state.tries, 1);
  // The link alone is a return in itself (a split-screen iPad never went to the background).
  const c = confirmStep();
  c.state.link();
  assert.equal(c.state.tries, 1);
  // Never a loop: more links straight after start nothing, a later return tries once more.
  c.state.link(); c.state.now += 1_000; c.state.link();
  assert.equal(c.state.tries, 1);
  c.away(30_000); c.state.link();
  assert.equal(c.state.tries, 2);
  // Never on top of a running try, and never without the password.
  const busy = confirmStep(); busy.scope.busyRef.current = true; busy.state.link();
  assert.equal(busy.state.tries, 0);
  const none = confirmStep({ password: '' }); none.state.link();
  assert.equal(none.state.tries, 0);
});

test('M4: a link after more than five minutes away forgets the password instead of using it', () => {
  const h = confirmStep();
  h.away(5 * 60_000 + 1); h.state.link();
  assert.equal(h.state.tries, 0);
  assert.equal(h.state.forgotten, 1);
  assert.deepEqual(h.state.notices, ['passwordForgotten']);
  // The app coming forward a moment later finds nothing more to do.
  h.state.appState('active');
  assert.equal(h.state.tries, 0); assert.equal(h.state.forgotten, 1);
  // Leaving the step stops both listeners.
  h.cleanup();
  assert.equal(h.state.appState, null); assert.equal(h.state.link, null);
});
