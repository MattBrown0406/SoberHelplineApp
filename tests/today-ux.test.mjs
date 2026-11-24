import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Execute real component render functions with deterministic React/native doubles.
// This verifies event/state contracts, not native layout or device accessibility.
function mount(name, props = {}) {
  const states = []; let cursor = 0; let tree; const routes = []; const alerts = [];
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useEffect() {},
  };
  const native = Object.fromEntries(['View', 'Text', 'TextInput', 'TouchableOpacity'].map(x => [x, x]));
  native.StyleSheet = { create: x => x }; native.Alert = { alert: (...args) => alerts.push(args) };
  const require = id => {
    if (id === 'react') return React;
    if (id === 'react-native') return native;
    if (id === 'expo-router') return { useRouter: () => ({ push: route => { routes.push(route); } }) };
    if (id === 'react-i18next') return { useTranslation: () => ({ t: (key, params) => params ? `${key}:${JSON.stringify(params)}` : key }) };
    if (id === '@expo/vector-icons/MaterialCommunityIcons') return { __esModule: true, default: 'MaterialCommunityIcons' };
    if (id.includes('ThemeContext')) return { useTheme: () => ({ colors: {} }) };
    if (id.endsWith('ui/Button')) return { buttonShape: {}, BUTTON_RADIUS: 99, BUTTON_MIN_HEIGHT: 48 };
    if (id.endsWith('lib/appAlert')) return { appAlert: (...args) => alerts.push(args) };
    if (id.endsWith('safety/EmergencyActions')) return { EmergencyActions: 'EmergencyActions' };
    if (id.includes('caregiverCheckIn')) return { CAREGIVER_SUPPORT_NEEDS: ['rest', 'safety'], CAREGIVER_RESPONSE_ROUTE: {}, caregiverResponseKey: () => null };
    throw Error(id);
  };
  const source = readFileSync(new URL(`../src/components/today/${name}.tsx`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const exports = {}; new Function('require', 'exports', output)(require, exports);
  function flatten(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(flatten);
    if (typeof node.type === 'function') return flatten(node.type(node.props));
    return [node, ...flatten(node.props.children)];
  }
  const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join(' ') : node?.props ? text(node.props.children) : '';
  const api = {
    render() { cursor = 0; tree = exports[name](props); return api; },
    nodes: () => flatten(tree),
    button(key) { return flatten(tree).find(n => n.type === 'TouchableOpacity' && text(n).includes(key)); },
    press(key) { const b = api.button(key); assert.ok(b, `button ${key}`); assert.ok(!b.props.disabled, `${key} enabled`); b.props.onPress(); api.render(); },
    routes, alerts,
  };
  return api.render();
}

function start(onComplete = async () => {}) {
  return mount('CheckInCard', { checkIn: null, onComplete, newStreak: 0, isAttached: false, orgName: null });
}
function answer(ui, label) { const n = ui.nodes().find(n => n.type === 'TouchableOpacity' && n.props.accessibilityLabel?.startsWith(label)); assert.ok(n); n.props.onPress(); ui.render(); }
function reachLast(ui) {
  answer(ui, 'checkIn.moodAccessibility'); ui.press('checkIn.next');
  answer(ui, 'checkIn.capacityAccessibility'); ui.press('checkIn.next');
  answer(ui, 'checkIn.pressureAccessibility'); ui.press('checkIn.next');
}

test('check-in reveals one question, blocks unanswered advancement and preserves answers on Back', () => {
  const ui = start();
  assert.equal(ui.button('checkIn.next').props.disabled, true);
  assert.equal(ui.nodes().filter(n => n.props.accessibilityRole === 'radiogroup').length, 1);
  answer(ui, 'checkIn.moodAccessibility'); ui.press('checkIn.next'); ui.press('checkIn.back');
  assert.equal(ui.nodes().filter(n => n.props.accessibilityRole === 'radio' && n.props.accessibilityState.selected).length, 1);
  ui.press('checkIn.next'); assert.equal(ui.button('checkIn.next').props.disabled, true);
});

test('optional note is hidden initially; check-in saves without it', async () => {
  let saved; const ui = start(async input => { saved = input; }); reachLast(ui);
  assert.equal(ui.nodes().some(n => n.type === 'TextInput'), false);
  ui.press('checkIn.supportNeeds.rest'); ui.press('checkIn.completeButton');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(saved, { moodScore: 1, capacityScore: 1, pressureScore: 1, supportNeed: 'rest', note: '' });
});

test('safety help is actionable before save; hidden note and failed save preserve answers', async () => {
  const ui = start(async () => { throw Error('offline'); }); reachLast(ui);
  ui.press('checkIn.supportNeeds.safety'); ui.press('checkIn.responses.safety.cta');
  assert.deepEqual(ui.routes, ['/safety-wallet']);
  ui.press('checkIn.addNote'); ui.nodes().find(n => n.type === 'TextInput').props.onChangeText('keep this'); ui.render();
  ui.press('checkIn.hideNote'); ui.press('checkIn.back'); ui.press('checkIn.next'); ui.press('checkIn.addNote');
  assert.equal(ui.nodes().find(n => n.type === 'TextInput').props.value, 'keep this');
  ui.press('checkIn.completeButton'); await new Promise(resolve => setImmediate(resolve)); ui.render();
  assert.equal(ui.alerts.length, 1); assert.equal(ui.button('checkIn.completeButton').props.disabled, false);
  assert.equal(ui.nodes().find(n => n.type === 'TextInput').props.value, 'keep this');
});

test('needs front door keeps crisis immediate and reveals every secondary route', () => {
  const ui = mount('NeedsRouter'); ui.press('needs.crisis'); assert.equal(ui.routes[0], '/crisis-mode');
  assert.equal(ui.button('needs.findTreatment'), undefined); ui.press('needs.more'); ui.press('needs.findTreatment');
  assert.equal(ui.routes[1], '/finder');
  for (const key of ['money', 'using', 'treatmentTalk', 'boundary']) assert.ok(ui.button(`needs.${key}`));
});

test('disclosure starts collapsed and keeps opened child content mounted when closed', () => {
  const ui = mount('TodayDisclosure', { title: 'Practice', children: 'draft' });
  // The wrapper, the row, its title and its chevron: no content until she opens it.
  assert.equal(ui.nodes().length, 4); ui.press('Practice'); ui.press('Practice');
  assert.ok(ui.nodes().some(n => n.props.style?.display === 'none'));
});

test('a section row is the title and a chevron, and says open or closed without writing it in the title', () => {
  const ui = mount('TodayDisclosure', { title: 'Practice', children: 'draft' });
  const row = () => ui.button('Practice');
  const chevron = () => ui.nodes().find(n => n.type === 'MaterialCommunityIcons');
  const title = () => ui.nodes().find(n => n.type === 'Text');
  assert.deepEqual(title().props.children, ['Practice']);
  assert.equal(row().props.accessibilityRole, 'button');
  assert.equal(row().props.accessibilityLabel, 'Practice');
  assert.deepEqual(row().props.accessibilityState, { expanded: false });
  assert.equal(row().props['aria-expanded'], false);
  assert.equal(row().props.accessibilityHint, 'disclosure.show');
  assert.equal(chevron().props.name, 'chevron-down');
  assert.equal(chevron().props.accessible, false);
  // A full-width row with a comfortable target and a hairline under it.
  const style = Object.assign({}, ...row().props.style);
  assert.equal(style.flexDirection, 'row');
  assert.ok(style.minHeight >= 48);
  assert.equal(style.height, undefined, 'the row grows with large text');
  assert.ok('borderBottomWidth' in style && 'borderBottomColor' in style);
  ui.press('Practice');
  assert.deepEqual(row().props.accessibilityState, { expanded: true });
  assert.equal(row().props['aria-expanded'], true);
  assert.equal(row().props.accessibilityHint, 'disclosure.hide');
  assert.equal(chevron().props.name, 'chevron-up');
  assert.deepEqual(title().props.children, ['Practice']);
});

test('both Today tiers do one job: call, check-in, one next step and needs, then ONE collapsed "More for you"', () => {
  const source = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  const all = source.split('<ScreenContainer').slice(1);
  // Two Todays, free and member (4.4: the bereaved Today was removed).
  assert.equal(all.length, 2);
  const screens = all.filter((screen) => screen.includes('{checkInCard}')); assert.equal(screens.length, 2);
  for (const screen of screens) {
    // Greeting (and welcome back), the Monday meeting with its reminder ask,
    // the check-in and its feedback, ONE next step, "What do you need right
    // now?", then the one collapsed section.
    const order = ['{header}', '{welcomeBackCard}', '{mondayCallCard}', '{reminderAskCard}', '{checkInCard}', '<CheckInFeedbackCard', '...nextStepSlot', '<NeedsRouter', '...moreForYou(', '{curriculumCard}', '{holdLogCard}', '<MoodChart', '{signsToWatchRow}'];
    const at = order.map((piece) => screen.indexOf(piece));
    assert.ok(at.every((index) => index >= 0), `missing: ${order.filter((_, i) => at[i] < 0).join(', ')}`);
    assert.deepEqual(at, [...at].sort((a, b) => a - b), 'Today order');
    // Only one collapsed section at the top level; no second set of sections.
    assert.equal((screen.match(/<TodayDisclosure /g) ?? []).length, screen.includes('<ExploreMembership') ? 1 : 0);
    // The cards that compete for the slot are never also stacked on the screen.
    for (const card of ['{willingnessWindowAlert}', '{lovedOneCheckCard}', '{holidayCard}', '{invitationCard}', '<GuidedStartPanel', '<PathNextStepCard']) {
      assert.ok(!screen.includes(card), `${card} only through the next-step slot`);
    }
    // Moved off Today: the invite card (Support) and the free daily script (Practice).
    for (const gone of ['<PassItOnCard', '<ScriptCard', 'freeDaily', 'disclosure.invite', 'disclosure.practice', 'disclosure.pathway']) {
      assert.ok(!screen.includes(gone), `${gone} is not on Today`);
    }
  }
  assert.ok(!source.includes('PassItOnCard') && !source.includes('getDailyScripts'));
  // "More for you": her path first, then this week's other steps, then the rest; all mounted once she opens it.
  const more = source.slice(source.indexOf('const moreForYou = '), source.indexOf('const curriculumCard'));
  const moreOrder = ["title={t('disclosure.more')}", "moreSection('path', pathwayCard)", 'NEXT_STEP_PRIORITY.filter', "moreSection('rest', rest)"].map((piece) => more.indexOf(piece));
  assert.ok(moreOrder.every((index) => index >= 0));
  assert.deepEqual(moreOrder, [...moreOrder].sort((a, b) => a - b));
  assert.match(source, /<View key=\{key\} style=\{\{ display: moreOpen \? 'flex' : 'none' \}\}>\s*\{moreVisited && children\}/);
  // "Signs to watch" opens the Tracker screen (no longer a tab).
  assert.match(source, /router\.push\('\/tracker' as never\)/);
  // Paid-only cards stay on the paid Today only, inside "More for you".
  const paid = screens.filter((screen) => screen.includes('<HeroCard'));
  assert.equal(paid.length, 1);
  const paidOrder = ['...moreForYou(', '{holdLogCard}', '<ContinueLetterCard', '<HeroCard', '<WeekReviewCard', '<MoodChart', '{signsToWatchRow}'].map((piece) => paid[0].indexOf(piece));
  assert.deepEqual(paidOrder, [...paidOrder].sort((a, b) => a - b));
  const free = screens.find((screen) => !screen.includes('<HeroCard'));
  for (const card of ['<ContinueLetterCard', '<WeekReviewCard']) assert.ok(!free.includes(card));
  // The free Today ends with the membership invitation (the plans teaser), last inside "More for you".
  assert.ok(free.includes('<ExploreMembership />'));
  assert.ok(free.indexOf('{signsToWatchRow}') < free.indexOf('<ExploreMembership />'));
  assert.match(free, /\n\s+<TodayDisclosure title=\{t\('disclosure\.membership'\)\}>/);
  assert.ok(!paid[0].includes('<ExploreMembership'), 'a member with a plan sees no sales card');
  assert.ok(!source.includes('FreeTierPaywall'));
  // The after-meeting invitation stays on the free Today, under the reminder ask, before the check-in.
  assert.ok(free.indexOf('{reminderAskCard}') < free.indexOf('<ContextualMembershipInvitation'));
  assert.ok(free.indexOf('<ContextualMembershipInvitation') < free.indexOf('{checkInCard}'));
  assert.match(source, /useToolOpened\('today'\)/);
  for (const lang of ['en', 'es']) {
    const locale = JSON.parse(readFileSync(new URL(`../src/locales/${lang}/today.json`, import.meta.url), 'utf8'));
    for (const key of ['progress', 'next', 'back', 'addNote', 'hideNote']) assert.ok(locale.checkIn[key]);
    assert.ok(locale.needs.more);
    assert.ok(locale.disclosure.more && locale.disclosure.membership);
    assert.ok(locale.moreForYou.signsTitle && locale.moreForYou.signsBody);
    assert.match(locale.pathStep.title, /\{\{phase\}\}/);
    assert.equal(locale.freeDaily, undefined);
    // The share card's section title is kept for the Support tab (it shares La Sobremesa in Spanish).
    assert.match(locale.disclosure.invite, lang === 'es' ? /La Sobremesa/ : /Family Squares/); assert.equal(locale.disclosure.connection, undefined);
  }
});

test('/guided-journey (winback push, check-in feedback) leads to Today with "More for you" open', () => {
  const route = readFileSync(new URL('../app/guided-journey.tsx', import.meta.url), 'utf8');
  assert.match(route, /<Redirect href=\{\{ pathname: '\/\(tabs\)', params: \{ more: '1', n: visit \} \}\} \/>/);
  assert.doesNotMatch(route, /useGuidedStart|GuidedButton/);
  const today = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  assert.match(today, /useLocalSearchParams<\{ more\?: string; n\?: string \}>\(\)/);
  assert.match(today, /if \(openMoreParam !== '1'\) return;\s*setMoreVisited\(true\);\s*setMoreOpen\(true\);/);
  assert.match(today, /\}, \[openMoreParam, openMoreNonce\]\);/);
});
