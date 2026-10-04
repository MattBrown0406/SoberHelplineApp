import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const element = (type, props, ...children) => ({ type, props: { ...props, children } });
function nodes(tree) { return tree && typeof tree === 'object' ? [tree, ...[tree.props?.children].flat(2).flatMap(nodes)] : []; }
function declaration(file, name) {
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(ast); ts.forEachChild(node, visit); }
  visit(ast); assert.ok(found); return found.replace(/^export /, '');
}
function runDeclaration(file, name, globals) { const ctx = vm.createContext(globals); vm.runInContext(compile(declaration(file, name)), ctx); return ctx[name]; }
const native = Object.fromEntries(['View', 'Text', 'TouchableOpacity'].map(x => [x, x]));
const theme = () => ({ colors: { primary: 'blue' } });

test('invitation choices expose native and web checked state and call selection handler', () => {
  let selected = false;
  const Choice = runDeclaration('app/invitation-setup.tsx', 'Choice', { React: { createElement: element }, ...native, useTheme: theme, styles: {} });
  for (const role of ['radio', 'checkbox']) {
    selected = false;
    const render = () => Choice({ label: 'Synthetic option', selected, role, onPress: () => { selected = !selected; } });
    let tree = render(); assert.equal(tree.props.accessibilityRole, role); assert.equal(tree.props['aria-checked'], false); assert.equal(tree.props.accessibilityState.checked, false);
    tree.props.onPress(); tree = render(); assert.equal(tree.props['aria-checked'], true); assert.equal(tree.props.accessibilityState.checked, true);
  }
});

test('feature-specific paywall renders the AI feature and routes free exercise without changing the default gate', () => {
  const nav = [];
  const Gate = runDeclaration('src/components/ui/FreeTierPaywall.tsx', 'FreeTierPaywall', {
    React: { createElement: element }, ...native, ScreenContainer: 'ScreenContainer', useTheme: theme,
    useTranslation: () => ({ t: k => k, i18n: { language: 'en' } }), walletMembershipCopy: () => ({ free: 'free' }),
    useRouter: () => ({ push: path => { nav.push(path); } }), styles: {},
  });
  const tree = Gate({ feature: 'aiRehearsal' });
  assert.ok(JSON.stringify(tree).includes('practiceGate.heading'));
  const buttons = nodes(tree).filter(n => n.type === 'TouchableOpacity');
  buttons.forEach(n => n.props.onPress());
  assert.deepEqual(nav, ['/free-practice', '/crisis-mode', '/(tabs)/support']);
  assert.ok(JSON.stringify(Gate({})).includes('paywall.heading'));
  assert.ok(!JSON.stringify(Gate({})).includes('practiceGate.freeAction'));
  assert.match(read('src/components/rehearsal/PracticeHandoffPaywall.tsx'), /releasePracticeText\(handoff\)/);
  assert.match(read('app/rehearsal-live.tsx'), /Gate feature="aiRehearsal" fallback=\{<PracticeHandoffPaywall/);
});

test('free chat gate retains plans and adds safe Back and ungated crisis route', () => {
  const screen = read('app/chat.tsx');
  const gate = screen.slice(screen.indexOf('if (!canUseTextLine && !loading && messages.length === 0)'), screen.indexOf('const canSend'));
  assert.match(gate, /router\.canGoBack\(\)/); assert.match(gate, /router\.back\(\)/);
  assert.match(gate, /router\.replace\('\/\(tabs\)\/support'\)/);
  assert.match(gate, /router\.push\('\/crisis-mode'\)/);
  assert.match(gate, /textline.freeUrgentHelp/); assert.match(gate, /textline.viewPlans/);
});

for (const lang of ['en', 'es']) test(`${lang}: short labels retain full titles; paid messaging/practice promises stay honest`, () => {
  const common = JSON.parse(read(`src/locales/${lang}/common.json`));
  const support = JSON.parse(read(`src/locales/${lang}/support.json`));
  for (const key of ['today', 'scripts', 'boundaries', 'tracker', 'learn', 'support']) {
    assert.ok(common.navShort[key]); assert.ok(common.nav[key]);
    assert.ok(common.navShort[key].length <= 8);
    assert.match(read('app/(tabs)/_layout.tsx'), new RegExp(`tabBarLabel: t\\('navShort\\.${key}'\\)`));
  }
  assert.doesNotMatch(support.textline.gatedTitle, /Urgent|Urgente/);
  assert.doesNotMatch(support.chat.presenceBody, /within a few hours|pocas horas|unas horas/);
  assert.match(support.practiceGate.body, /Essential.*Premier/);
  assert.ok(support.practiceGate.freeAction);
  assert.match(support.privateVideo.body, lang === 'en' ? /staff availability/ : /disponibilidad/);
  // The coaching price is member-aware ($125 member price / $150), filled in by the screen.
  assert.match(support.coaching.cardBody, /\{\{rate\}\}/);
  assert.doesNotMatch(support.coaching.cardBody, /\$\d/);
});

test('rehearsal radio choices have checked semantics on both adapters', () => {
  const source = read('app/rehearsal-live.tsx');
  const ast = ts.createSourceFile('screen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let count = 0;
  function visit(n) {
    if (ts.isJsxOpeningElement(n) && n.attributes.properties.some(p => p.name?.getText(ast) === 'accessibilityRole' && p.initializer?.getText(ast) === '"radio"')) {
      const attrs = n.attributes.getText(ast); assert.match(attrs, /accessibilityState=\{\{ checked:/); assert.match(attrs, /aria-checked=/); count++;
    }
    ts.forEachChild(n, visit);
  }
  visit(ast); assert.equal(count, 8);
});

test('practice explanation toggles only disclosure, with warm-up ahead of setup and safety copy outside', () => {
  const s = read('app/rehearsal-live.tsx');
  assert.ok(s.indexOf("t('setup.warmupLink')") < s.indexOf("t('setup.relationshipLabel')"));
  assert.match(s, /\[whyExpanded, setWhyExpanded\] = useState\(false\)/);
  assert.match(s, /aria-expanded=\{whyExpanded\}/);
  assert.match(s, /onPress=\{\(\) => setWhyExpanded\(\(value\) => !value\)\}/);
  assert.match(s, /\{whyExpanded && <Text[^\n]*setup.whyBody/);
  assert.ok(s.includes("t('setup.reassurance')"));
  assert.ok(s.includes("t('privacyNote')"));
});

test('Support actions precede disclosure and pricing remains separate; disclosure does not own scheduling form', () => {
  const s = read('app/(tabs)/support.tsx');
  const urgent = s.indexOf("t('crisis.freeNote')"), message = s.indexOf("t('chat.openButton')"), video = s.indexOf('<PremierVideoSchedulingCard'), explanation = s.indexOf('{copy.benefits}');
  assert.ok(urgent < message && message < video && video < explanation);
  assert.equal(s.split('<PremierVideoSchedulingCard').length - 1, 1);
  assert.match(s, /\[membershipExpanded, setMembershipExpanded\] = useState\(false\)/);
  assert.match(s, /aria-expanded=\{membershipExpanded\}/);
  assert.match(s, /display: membershipExpanded \? 'flex' : 'none'/);
  assert.ok(s.indexOf("t('coaching.cardBody', { rate: coachingRate.hourly })") > explanation);
});

test('primary practice/invitation/support/scheduling hit areas have explicit 44pt minimums', () => {
  for (const [file, keys] of [
    ['app/rehearsal-live.tsx', ['chip', 'smallChip', 'voiceToggle', 'historyLink', 'disclosureButton']],
    ['app/invitation-setup.tsx', ['choice']],
    ['app/(tabs)/support.tsx', ['outlineBtn', 'solidBtn', 'membershipDisclosure']],
    ['src/components/video/PremierVideoSchedulingCard.tsx', ['action', 'secondary', 'field']],
  ]) for (const key of keys) assert.match(read(file), new RegExp(`\\b${key}: \\{[^}]*minHeight: 44`), `${file} ${key}`);
});
