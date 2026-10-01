import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function transpile(path, mocks) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: (id) => { if (!(id in mocks)) throw Error(id); return mocks[id]; } });
  return module.exports;
}
test('real export component requires selection and preview, passes identical text to Share/Print, and resets on close', async () => {
  let index = 0; const slots = []; const shares = []; const prints = []; const alerts = [];
  const react = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }), useState: (initial) => { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; } };
  const model = transpile('src/lib/safetyWallet.ts', {});
  const exports = transpile('src/lib/safetyWalletExport.ts', { './safetyWallet': model });
  const copyModule = transpile('src/content/walletMembershipCopy.ts', {});
  const copy = copyModule.walletMembershipCopy('en');
  const { SafetyWalletExport } = transpile('src/components/safety/SafetyWalletExport.tsx', {
    react: { ...react, default: react },
    'react-native': { Platform: { OS: 'ios' }, Share: { share: async (value) => shares.push(value) }, Text: 'Text', TouchableOpacity: 'Button', View: 'View' },
    'expo-print': { printAsync: async (value) => prints.push(value) },
    'expo-clipboard': { setStringAsync: async () => assert.fail('native shares through the share sheet') },
    '../../lib/appAlert': { appAlert: (...args) => alerts.push(args) },
    '../../lib/webShare': transpile('src/lib/webShare.ts', {}),
    'react-i18next': { useTranslation: () => ({ i18n: { language: 'en' }, t: () => 'Wallet' }) },
    '../../contexts/ThemeContext': { useTheme: () => ({ colors: {} }) },
    '../../content/walletMembershipCopy': copyModule,
    '../../lib/safetyWalletExport': exports,
  });
  let items = [{ id: 'contacts', label: 'Contacts', value: '<Alex>' }, { id: 'private', label: 'Insurance', value: 'SECRET' }];
  let scope = 'account-a'; let lastKey;
  const render = () => {
    index = 0;
    const session = SafetyWalletExport({ items, scope });
    if (session.props.key !== lastKey) { slots.length = 0; lastKey = session.props.key; }
    return session.type(session.props);
  };
  const flatten = (node) => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(flatten) : [node, ...node.children.flatMap(flatten)];
  const button = (label) => flatten(render()).find((n) => n.type === 'Button' && n.children.some((c) => c?.children?.includes(label)));
  button(copy.choose).props.onPress();
  assert.equal(button(copy.preview).props.disabled, true);
  assert.equal(button(copy.share), undefined);
  flatten(render()).find((n) => n.props.accessibilityRole === 'checkbox').props.onPress();
  button(copy.preview).props.onPress();
  const preview = flatten(render()).find((n) => n.props.selectable).children[0];
  assert.ok(preview.includes('<Alex>') && !preview.includes('SECRET'));
  button(copy.share).props.onPress(); await new Promise(setImmediate);
  assert.equal(shares[0].message, preview);
  button(copy.print).props.onPress(); await new Promise(setImmediate);
  assert.equal(prints[0].html, exports.walletPrintHtml(preview));
  button(copy.close).props.onPress(); button(copy.choose).props.onPress();
  assert.equal(button(copy.preview).props.disabled, true);
  assert.equal(alerts.length, 0);
  for (const change of [
    () => { items = items.map((item) => ({ ...item, value: 'EDITED' })); },
    () => { scope = 'account-b'; },
    () => { items = []; },
  ]) {
    flatten(render()).find((n) => n.props.accessibilityRole === 'checkbox').props.onPress();
    button(copy.preview).props.onPress();
    assert.ok(button(copy.share));
    change();
    assert.equal(button(copy.share), undefined);
    assert.equal(flatten(render()).some((n) => n.props.selectable), false);
    button(copy.choose).props.onPress();
    assert.equal(button(copy.preview).props.disabled, true);
  }
});

test('on web, Print prints only the selected preview in its own window and Share falls back to the clipboard', async () => {
  let index = 0; const slots = []; const prints = []; const windowPrints = []; const copies = []; const alerts = [];
  const react = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }), useState: (initial) => { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; } };
  const model = transpile('src/lib/safetyWallet.ts', {});
  const exports = transpile('src/lib/safetyWalletExport.ts', { './safetyWallet': model });
  const copyModule = transpile('src/content/walletMembershipCopy.ts', {});
  const copy = copyModule.walletMembershipCopy('en');
  const webShare = transpile('src/lib/webShare.ts', {});
  const { SafetyWalletExport } = transpile('src/components/safety/SafetyWalletExport.tsx', {
    react: { ...react, default: react },
    'react-native': { Platform: { OS: 'web' }, Share: { share: async () => { throw new Error('Share is not supported in this browser'); } }, Text: 'Text', TouchableOpacity: 'Button', View: 'View' },
    'expo-print': { printAsync: async (value) => prints.push(value) },
    'expo-clipboard': { setStringAsync: async (value) => { copies.push(value); } },
    'react-i18next': { useTranslation: () => ({ i18n: { language: 'en' }, t: (key) => key }) },
    '../../contexts/ThemeContext': { useTheme: () => ({ colors: {} }) },
    '../../content/walletMembershipCopy': copyModule,
    '../../lib/safetyWalletExport': exports,
    '../../lib/appAlert': { appAlert: (...args) => alerts.push(args) },
    '../../lib/webShare': { ...webShare, canOpenPrintWindow: () => true, webCanShare: () => false,
      printHtmlInNewWindow: (_scope, html) => { windowPrints.push(html); return 'printed'; } },
  });
  const items = [{ id: 'contacts', label: 'Contacts', value: 'Alex 555' }, { id: 'private', label: 'Weapons', value: 'SECRET' }];
  const render = () => { index = 0; const session = SafetyWalletExport({ items, scope: 'a' }); return session.type(session.props); };
  const flatten = (node) => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(flatten) : [node, ...node.children.flatMap(flatten)];
  const button = (label) => flatten(render()).find((n) => n.type === 'Button' && n.children.some((c) => c?.children?.includes(label)));
  button(copy.choose).props.onPress();
  flatten(render()).find((n) => n.props.accessibilityRole === 'checkbox').props.onPress();
  button(copy.preview).props.onPress();
  const preview = flatten(render()).find((n) => n.props.selectable).children[0];
  button(copy.print).props.onPress(); await new Promise(setImmediate);
  assert.deepEqual(prints, [], 'expo-print would print the whole screen on web');
  assert.deepEqual(windowPrints, [exports.walletPrintHtml(preview)]);
  assert.ok(!windowPrints[0].includes('SECRET'));
  button(copy.share).props.onPress(); await new Promise(setImmediate);
  assert.deepEqual(copies, [preview]);
  assert.deepEqual(alerts.map((args) => args[0]), ['wallet.copiedToClipboard']);
});

test('pure web share/print helpers', async () => {
  const { shareOrCopy, printHtmlInNewWindow, canOpenPrintWindow, webCanShare } = transpile('src/lib/webShare.ts', {});
  const copied = [];
  const deps = (share) => ({ canShare: true, share, copy: async (text) => { copied.push(text); } });
  assert.equal(await shareOrCopy('t', deps(async () => undefined)), 'shared');
  assert.equal(await shareOrCopy('t', deps(async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; })), 'cancelled');
  assert.equal(await shareOrCopy('t', deps(async () => { throw new Error('unsupported'); })), 'copied');
  assert.equal(await shareOrCopy('t', { canShare: false, share: async () => assert.fail(), copy: async () => { throw new Error('denied'); } }), 'failed');
  assert.deepEqual(copied, ['t']);
  const written = []; let printed = 0;
  const win = { document: { open() {}, write: (html) => written.push(html), close() {} }, print: () => { printed++; }, focus() {}, close() {} };
  assert.equal(printHtmlInNewWindow({ open: () => win }, '<p>x</p>'), 'printed');
  assert.deepEqual(written, ['<p>x</p>']); assert.equal(printed, 1);
  assert.equal(printHtmlInNewWindow({ open: () => null }, '<p>x</p>'), 'blocked');
  assert.equal(printHtmlInNewWindow({}, '<p>x</p>'), 'blocked');
  assert.equal(canOpenPrintWindow({ open() {} }), true);
  assert.equal(canOpenPrintWindow({}), false);
  assert.equal(webCanShare({ navigator: { share() {} } }), true);
  assert.equal(webCanShare({ navigator: {} }), false);
});
