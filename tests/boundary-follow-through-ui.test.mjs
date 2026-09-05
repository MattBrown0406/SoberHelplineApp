import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function moduleAt(path, require) {
  const js = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const exports = {}; new Function('require', 'exports', js)(require, exports); return exports;
}
const copyModule = moduleAt('src/components/boundaries/followThroughCopy.ts', () => { throw Error('unexpected import'); });
const core = moduleAt('src/storage/boundaryFollowThroughCore.ts', () => { throw Error('unexpected import'); });
const settle = () => new Promise(resolve => setImmediate(resolve));
function mount(name, props, store = {}, language = 'en') {
  const slots = []; let cursor = 0; let tree; const effects = []; const routes = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((v, j) => v !== slots[i][j])) { slots[i] = deps; effects.push(fn); } },
  };
  const require = id => {
    if (id === 'react') return React;
    if (id === 'react-native') return { ...Object.fromEntries(['View', 'Text', 'TextInput', 'TouchableOpacity'].map(x => [x, x])), StyleSheet: { create: x => x } };
    if (id === 'expo-router') return { useRouter: () => ({ push: r => { routes.push(r); } }) };
    if (id === 'react-i18next') return { useTranslation: () => ({ t: k => k, i18n: { language } }) };
    if (id.includes('ThemeContext')) return { useTheme: () => ({ colors: {} }) };
    if (id.endsWith('followThroughCopy')) return copyModule;
    if (id.endsWith('boundaryFollowThroughCore')) return core;
    if (id.endsWith('boundaryFollowThrough')) return { boundaryFollowThroughStore: store };
    if (id.endsWith('ContextualMembershipInvitation')) return { ContextualMembershipInvitation: 'Invitation' };
    if (id.endsWith('BoundaryFollowThroughCard')) return { BoundaryFollowThroughCard: 'Editor' };
    throw Error(id);
  };
  const exports = moduleAt(`src/components/boundaries/${name}.tsx`, require);
  const flatten = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(flatten) : [n, ...flatten(n.props.children)];
  const text = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join(' ') : n?.props ? text(n.props.children) : '';
  const api = {
    render() { cursor = 0; tree = exports[name](props); while(effects.length) effects.shift()(); return api; },
    nodes: () => flatten(tree), text: () => text(tree), routes,
    press(label) { const n = api.nodes().find(n => n.type === 'TouchableOpacity' && text(n) === label); assert.ok(n, label); assert.ok(!n.props.disabled); n.props.onPress(); api.render(); },
    edit(label, value) { const n = api.nodes().find(n => n.type === 'TextInput' && n.props.accessibilityLabel === label); assert.ok(n); n.props.onChangeText(value); api.render(); },
  };
  return api.render();
}
const wall = { id: 'wall', text: 'Private wall', createdAt: '2026-09-05T12:00:00Z' };
test('inactive coach CTA now invokes supported booking route without a data payload, EN and ES', () => {
  for (const language of ['en', 'es']) for (const isAttached of [true, false]) {
    const ui = mount('WallsList', { walls: [wall], isAttached, onDelete() {} }, {}, language);
    const copy = copyModule.boundaryFollowThroughCopy(language);
    ui.press(copy.coach); assert.deepEqual(ui.routes, ['/book-coaching']);
    assert.ok(ui.text().includes(copy.coachPrivacy));
  }
  assert.ok(readFileSync(new URL('../app/book-coaching.tsx', import.meta.url), 'utf8').includes("from('coaching_bookings')"));
});
test('editor validates, keeps drafts when collapsed, persists responses only locally, retains text on write failure', async () => {
  const saved = []; let fail = false;
  const ui = mount('BoundaryFollowThroughCard', { accountId: 'a', wallId: 'wall' }, {
    get: async () => null, save: async (...args) => { if (fail) throw Error('disk'); saved.push(args); },
  });
  await settle(); ui.render(); const copy = copyModule.boundaryFollowThroughCopy('en');
  ui.press(copy.open); ui.press(copy.save); assert.equal(saved.length, 0); assert.ok(ui.text().includes(copy.invalid));
  ui.edit(copy.communicate, 'I care about you'); ui.edit(copy.action, 'I will step away'); ui.edit(copy.reviewDate, '2026-09-07');
  ui.press(copy.open); ui.press(copy.open); assert.equal(ui.nodes().find(n => n.props.accessibilityLabel === copy.communicate).props.value, 'I care about you');
  ui.press(copy['not-yet']); await settle(); ui.render();
  assert.equal(saved[0][0], 'a'); assert.equal(saved[0][1], 'wall'); assert.equal(saved[0][2].response, 'not-yet');
  assert.ok(ui.text().includes(copy['not-yetMessage']));
  fail = true; ui.edit(copy.action, 'Keep my draft'); ui.press(copy.save); await settle(); ui.render();
  assert.ok(ui.text().includes(copy.error)); assert.equal(ui.nodes().find(n => n.props.accessibilityLabel === copy.action).props.value, 'Keep my draft');
  fail = false; ui.press(copy.adjust); await settle(); ui.render(); ui.press(copy.coach);
  assert.deepEqual(ui.routes, ['/book-coaching']); assert.ok(ui.text().includes(copy.privacy));
  assert.equal(ui.nodes().find(n=>n.type==='Invitation').props.completed,false);
  ui.press(copy.save); await settle(); ui.render();
  const invitation=ui.nodes().find(n=>n.type==='Invitation');
  assert.equal(invitation.props.completed,true);
  assert.deepEqual(Object.keys(invitation.props).sort(),['accountId','children','completed','placement']);
});
test('corrupt/unreadable hydration exposes retry and cannot save an empty overwrite', async () => {
  let fail = true; let writes = 0;
  const ui = mount('BoundaryFollowThroughCard', { accountId: 'a', wallId: 'wall' }, { get: async () => { if(fail) throw Error('corrupt'); return null; }, save: async () => { writes++; } });
  const copy = copyModule.boundaryFollowThroughCopy('en'); await settle(); ui.render(); ui.press(copy.open);
  assert.equal(ui.nodes().filter(n => n.type === 'TextInput').length, 0); assert.equal(writes, 0);
  fail = false; ui.press(copy.retry); await settle(); ui.render(); assert.equal(ui.nodes().filter(n => n.type === 'TextInput').length, 3);
});
