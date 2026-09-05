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
    'react-native': { Alert: { alert: (...args) => alerts.push(args) }, Share: { share: async (value) => shares.push(value) }, Text: 'Text', TouchableOpacity: 'Button', View: 'View' },
    'expo-print': { printAsync: async (value) => prints.push(value) },
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
