import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function declaration(path, name) {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name).getText(source).replace('export default ', '').replace('export ', '');
}
function compile(source, globals, expression) {
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText;
  return vm.runInNewContext(`${js}\n${expression}`, globals);
}
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

// Deterministic child-lifecycle scheduler, not a native renderer. Execute actual
// gate, route wrappers and media effect callbacks with native IO doubles. Model
// React's keyed child mount/unmount contract, including stale async completion.
function fixture(path, wrapperName, contentName) {
  let accountId = null;
  let routeId = 'room-A';
  let child = null;
  let tree = null;
  const events = [];
  const requests = [];
  const React = { Fragment: 'Fragment', createElement(type, props, ...children) { return { type, props: { ...props, children: children.length === 1 ? children[0] : children } }; } };
  const gate = compile(declaration('src/contexts/RouteActivationContext.tsx', 'RouteActivationGate'), {
    React, RouteActivationContext: {}, useContext: () => accountId,
  }, 'RouteActivationGate');
  const marker = Symbol('content');
  const wrapper = compile(declaration(path, wrapperName), {
    React, RouteActivationGate: gate, [contentName]: marker,
    useLocalSearchParams: () => ({ sessionId: routeId, room: routeId }),
  }, wrapperName);
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const content = source.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === contentName);
  let effect;
  function visit(n) {
    if (!effect && ts.isCallExpression(n) && n.expression.getText(source) === 'useEffect') effect = n.arguments[0].getText(source);
    ts.forEachChild(n, visit);
  }
  visit(content);
  function update() {
    const element = wrapper();
    assert.equal(element.type, gate, 'media content must be below activation gate');
    const gated = gate(element.props);
    const media = gated?.props.children;
    const key = gated ? `${gated.props.key}/${media.props.key}` : null;
    if (child?.key !== key) { child?.cleanup(); child = null; }
    if (key !== null && !child) {
      const current = { key, token: null, error: null };
      const getToken = () => { events.push('token-request'); const request = deferred(); requests.push(request); return request.promise; };
      const callback = compile(`const effect = ${effect};`, {
        sessionId: routeId, roomName: routeId,
        mountedRef: { current: true }, tearingDownRef: { current: false },
        isHostRef: { current: false }, hostStartAttemptedRef: { current: false },
        transitionHostLive: () => events.push('host-stop'),
        AudioSession: {
          startAudioSession: async () => { events.push('audio-start'); },
          stopAudioSession: async () => { events.push('audio-stop'); },
        },
        fetchPrivateVideoToken: getToken, fetchLiveKitToken: getToken,
        setTokenResult: (v) => { current.token = v; }, setError: (v) => { current.error = v; },
      }, 'effect');
      current.cleanup = callback();
      child = current;
    }
    tree = gated;
    return child;
  }
  return { events, requests, update, setAccount(v) { accountId = v; return update(); }, setRoute(v) { routeId = v; return update(); }, tree: () => tree };
}
for (const [path, wrapper, content] of [
  ['app/video-session.native.tsx', 'VideoSessionScreen', 'VideoSessionContent'],
  ['app/live-room.native.tsx', 'LiveRoomScreen', 'LiveRoomSession'],
]) {
  test(`${wrapper}: no audio/admission while hidden; teardown, fresh tokens and stable active child`, async () => {
    const f = fixture(path, wrapper, content);
    f.update(); await settle();
    assert.deepEqual(f.events, []);
    assert.equal(f.tree(), null);
    const first = f.setAccount('account-A'); await settle();
    assert.deepEqual(f.events, ['audio-start', 'token-request']);
    f.requests[0].resolve({ token: 'first', isHost: false }); await settle();
    assert.equal(first.token.token, 'first');
    assert.equal(f.update(), first, 'same readiness must preserve media session');
    f.setAccount(null);
    assert.equal(f.events.at(-1), 'audio-stop');
    const second = f.setAccount('account-A'); await settle();
    assert.notEqual(second, first);
    assert.equal(second.token, null, 'reactivation must not reuse admission');
    f.setAccount(null);
    f.requests[1].resolve({ token: 'late', isHost: true }); await settle();
    assert.equal(second.token, null, 'unmounted request cannot publish its token');
    const third = f.setAccount('account-B'); await settle();
    assert.equal(third.token, null);
    const fourth = f.setAccount('account-C'); await settle();
    assert.notEqual(fourth, third, 'direct account switch must reset session');
    assert.equal(fourth.token, null);
    const nextRoom = f.setRoute('room-B'); await settle();
    assert.notEqual(nextRoom, fourth, 'new route admission must have a fresh lifecycle');
    f.setAccount(null);
  });
}

test('all rehearsal media wrappers gate before mounting hooks and native effects', () => {
  for (const [path, wrapper, content] of [
    ['app/rehearsal-incoming.tsx', 'RehearsalIncomingScreen', 'RehearsalIncomingContent'],
    ['app/rehearsal-live.tsx', 'RehearsalLiveScreen', 'RehearsalLiveContent'],
    ['app/rehearsal.tsx', 'RehearsalScreen', 'RehearsalContent'],
  ]) {
    const source = declaration(path, wrapper);
    assert.match(source, /return <RouteActivationGate>/);
    assert.match(source, new RegExp(`<${content}`));
    assert.doesNotMatch(source, /useEffect|Audio\.|Vibration\./);
  }
});

test('incoming vibration effect cancels native ringing on content teardown', () => {
  const path = 'app/rehearsal-incoming.tsx';
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function visit(n) {
    if (ts.isCallExpression(n) && n.expression.getText(source) === 'useEffect' && n.arguments[0].getText(source).includes('Vibration.vibrate')) callback = n.arguments[0].getText(source);
    ts.forEachChild(n, visit);
  }
  visit(source);
  const events = [];
  const effect = compile(`const effect = ${callback};`, {
    stage: 'ring', pulse: {}, Vibration: { vibrate: () => events.push('ring'), cancel: () => events.push('cancel') },
    Animated: { timing() {}, sequence() {}, loop: () => ({ start: () => events.push('animate'), stop: () => events.push('stop') }) },
  }, 'effect');
  const cleanup = effect();
  assert.deepEqual(events, ['ring', 'animate']);
  cleanup(); assert.deepEqual(events, ['ring', 'animate', 'cancel', 'stop']);
});

test('layout readiness fails closed until account-owned onboarding and redirects settle', () => {
  const source = ts.createSourceFile('layout.tsx', read('app/_layout.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const initial = source.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === 'InitialLayout');
  const declarations = initial.body.statements.filter(ts.isVariableStatement).flatMap((n) => [...n.declarationList.declarations]);
  const expression = declarations.find((n) => n.name.getText(source) === 'activationAccountId').initializer.getText(source);
  const ready = { layoutState: 'stack', isLoading: false, isAuthenticated: true, accountError: null, onboarded: true, segments: ['video-session'], user: { id: 'A' } };
  assert.equal(vm.runInNewContext(expression, ready), 'A');
  for (const patch of [{ layoutState: 'bootstrap' }, { layoutState: 'account-error' }, { isLoading: true }, { isAuthenticated: false }, { accountError: 'failed' }, { onboarded: null }, { onboarded: false }, { user: null }, { segments: ['(auth)'] }, { segments: ['(onboarding)'] }]) {
    assert.equal(vm.runInNewContext(expression, { ...ready, ...patch }), null);
  }
  const onboarded = declarations.find((n) => n.name.getText(source) === 'onboarded').initializer.getText(source);
  assert.equal(vm.runInNewContext(onboarded, { onboarding: { accountId: 'A', value: true }, user: { id: 'B' } }), null);
  assert.equal((read('app/_layout.tsx').match(/<Stack /g) ?? []).length, 1);
  assert.doesNotMatch(read('app/_layout.tsx'), /<Stack[^>]*key=/);
});
