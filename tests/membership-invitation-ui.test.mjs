import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Executes the real component and its effects; not a native renderer/layout test.
const source = readFileSync(new URL('../src/membershipInvitations/ContextualMembershipInvitation.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
const settle = () => new Promise(resolve => setImmediate(resolve));
function mount({ completed = false, account = {}, delayed = false } = {}) {
  let state = { user: { id: 'a' }, isAuthenticated: true, isLoading: false, accountError: null, isOfflineAccountFallback: false, isAdmin: false, isAttached: false, accountState: 'direct-free', ...account };
  let props = { accountId: 'a', completed, placement: 'practice-completed' };
  const slots = [], pending = [], claims = [], releases = [], dismissals = [], routes = [];
  let cursor = 0, tree, resolveClaim;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useEffect(fn, deps) { const i = cursor++; const old = slots[i]; if (!old || deps.some((d, j) => !Object.is(d, old.deps[j]))) { pending.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); } },
  };
  const policy = {
    claim(...args) { claims.push(args); return delayed ? new Promise(resolve => { resolveClaim = resolve; }) : Promise.resolve(true); },
    release(id) { releases.push(id); },
    dismiss(...args) { dismissals.push(args); return Promise.resolve(true); },
  };
  const require = id => {
    if (id === 'react') return React;
    if (id === 'react-native') return { View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: v => v } };
    if (id === '@react-native-async-storage/async-storage') return {};
    if (id === 'expo-router') return { useRouter: () => ({ push: route => { routes.push(route); } }) };
    if (id === 'react-i18next') return { useTranslation: () => ({ i18n: { language: 'en' } }) };
    if (id.endsWith('AccountContext')) return { useAccount: () => state };
    if (id === './policy') return { createInvitationPolicy: () => policy };
    throw Error(`Unexpected import ${id}`);
  };
  const exports = {}; new Function('require', 'exports', compiled)(require, exports);
  const flatten = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(flatten) : [n, ...flatten(n.props.children)];
  const text = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join(' ') : n?.props ? text(n.props.children) : '';
  const api = {
    claims, releases, dismissals, routes,
    render(next = {}, accountNext = {}) { props = { ...props, ...next }; state = { ...state, ...accountNext }; cursor = 0; tree = exports.ContextualMembershipInvitation(props); while (pending.length) pending.shift()(); return api; },
    visible: () => tree !== null,
    button(label) { const node = flatten(tree).find(n => n.type === 'Pressable' && text(n) === label); assert.ok(node, label); return node.props.onPress; },
    resolve(value) { resolveClaim(value); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
  return api.render();
}

test('initial completed hydration does not claim; persistent false-to-true claims once', async () => {
  const hydrated = mount({ completed: true }); await settle(); hydrated.render();
  assert.equal(hydrated.claims.length, 0); assert.equal(hydrated.visible(), false);
  const ui = mount(); ui.render({ completed: true }); await settle(); ui.render();
  assert.equal(ui.claims.length, 1); assert.equal(ui.visible(), true);
  assert.deepEqual(ui.claims[0].slice(0, 2), ['a', 'practice-completed']);
  ui.render(); assert.equal(ui.claims.length, 1);
  ui.render({ completed: false }); assert.equal(ui.visible(), false);
});

test('eligibility gates suppress claims and do not replay completion after becoming eligible', async () => {
  for (const account of [{ user: null }, { user: { id: 'b' } }, { isAuthenticated: false }, { isLoading: true }, { accountError: 'error' }, { isOfflineAccountFallback: true }, { isAdmin: true }, { isAttached: true }, { accountState: 'direct-essential' }]) {
    const ui = mount({ account }); ui.render({ completed: true }); await settle(); ui.render();
    assert.equal(ui.claims.length, 0, JSON.stringify(account)); assert.equal(ui.visible(), false);
    ui.render({}, { user: { id: 'a' }, isAuthenticated: true, isLoading: false, accountError: null, isOfflineAccountFallback: false, isAdmin: false, isAttached: false, accountState: 'direct-free' });
    assert.equal(ui.claims.length, 0);
  }
});

test('delayed claims cannot show after account switch, lost eligibility, completion withdrawal, or unmount', async () => {
  for (const change of ['account', 'eligibility', 'completed', 'unmount']) {
    const ui = mount({ delayed: true }); ui.render({ completed: true });
    const current = ui.claims[0][2]; assert.equal(current(), true);
    if (change === 'account') ui.render({ accountId: 'b' }, { user: { id: 'b' } });
    if (change === 'eligibility') ui.render({}, { isAdmin: true });
    if (change === 'completed') ui.render({ completed: false });
    if (change === 'unmount') ui.unmount();
    assert.equal(current(), false, change); ui.resolve(true); await settle();
    if (change !== 'unmount') { ui.render(); assert.equal(ui.visible(), false, change); }
    assert.deepEqual(ui.releases, ['a']);
  }
});

test('dismiss controls are explicit; explore only navigates and stale explore cannot navigate', async () => {
  for (const [label, permanent] of [['Not now', false], ['Don’t show again', true]]) {
    const ui = mount(); ui.render({ completed: true }); await settle(); ui.render();
    ui.button(label)(); ui.render(); assert.equal(ui.visible(), false);
    assert.deepEqual(ui.dismissals[0].slice(0, 2), ['a', permanent]); assert.deepEqual(ui.routes, []);
  }
  const ui = mount(); ui.render({ completed: true }); await settle(); ui.render();
  const explore = ui.button('Explore membership'); assert.deepEqual(ui.routes, []);
  explore(); assert.deepEqual(ui.routes, ['/membership-guide']);
  ui.render({}, { user: { id: 'b' } }); explore(); assert.deepEqual(ui.routes, ['/membership-guide']);
});
