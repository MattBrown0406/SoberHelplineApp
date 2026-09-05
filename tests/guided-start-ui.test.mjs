import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
function load(path, require) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const exports = {}; new Function('require', 'exports', code)(require, exports); return exports;
}
const copy = load('src/content/guidedStartCopy.ts', () => {});
const core = load('src/lib/guidedStart.ts', () => {});
test('onboarding urgent support and skip bypass unavailable storage without leaving onboarding, EN/ES', () => {
  for (const language of ['en', 'es']) {
    const slots = []; let cursor = 0; let writes = 0; let continued = 0; const routes = [];
    const React = {
      createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], v => { slots[i] = v; }]; },
    };
    const mod = load('src/components/today/GuidedStartPanel.tsx', id => {
      if (id === 'react') return React;
      if (id === 'react-native') return { Text: 'Text', View: 'View', TouchableOpacity: 'Button' };
      if (id === 'expo-router') return { useRouter: () => ({ push: r => { routes.push(r); } }) };
      if (id === 'react-i18next') return { useTranslation: () => ({ i18n: { language } }) };
      if (id.includes('ThemeContext')) return { useTheme: () => ({ colors: {} }) };
      if (id.includes('AccountContext')) return { useAccount: () => ({ user: { id: 'a' } }) };
      if (id.endsWith('useGuidedStart')) return { useGuidedStart: () => ({ ready: false, busy: true, error: 'load', value: core.emptyGuidedStart(), edit: async () => { writes++; throw Error('disk'); } }) };
      if (id.endsWith('guidedStartCopy')) return copy;
      if (id.endsWith('guidedStart')) return core;
      if (id.endsWith('EmergencyActions')) return { EmergencyActions: 'EmergencyActions' };
      throw Error(id);
    });
    const wrapper = mod.GuidedStartPanel({ onContinue: () => { continued++; } });
    const render = () => { cursor = 0; return wrapper.type(wrapper.props); };
    const flatten = n => Array.isArray(n) ? n.flatMap(flatten) : n && typeof n === 'object' ? [n, ...flatten(n.props.children)] : [];
    let nodes = flatten(render()); const c = copy.guidedStartCopy(language);
    const urgent = nodes.find(n => n.props.label === c.situations.urgent);
    assert.equal(urgent.props.disabled, false); urgent.props.onPress();
    nodes = flatten(render()); assert.ok(nodes.some(n => n.type === 'EmergencyActions'));
    assert.equal(writes, 0); assert.deepEqual(routes, []);
    const skip = nodes.find(n => n.props.label === c.skip); assert.ok(!skip.props.disabled); skip.props.onPress(); assert.equal(continued, 1);
  }
});
