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
    if (id.includes('ThemeContext')) return { useTheme: () => ({ colors: {} }) };
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

test('bereaved: the needs card is emergency help for her, not Crisis Mode about the loved one', () => {
  const ui = mount('NeedsRouter', { bereaved: true });
  assert.ok(ui.nodes().some((n) => n.type === 'EmergencyActions'));
  assert.equal(ui.button('needs.crisis'), undefined);
  assert.equal(ui.button('needs.more'), undefined);
});

test('needs front door keeps crisis immediate and reveals every secondary route', () => {
  const ui = mount('NeedsRouter'); ui.press('needs.crisis'); assert.equal(ui.routes[0], '/crisis-mode');
  assert.equal(ui.button('needs.findTreatment'), undefined); ui.press('needs.more'); ui.press('needs.findTreatment');
  assert.equal(ui.routes[1], '/finder');
  for (const key of ['money', 'using', 'treatmentTalk', 'boundary']) assert.ok(ui.button(`needs.${key}`));
});

test('disclosure starts collapsed and keeps opened child content mounted when closed', () => {
  const ui = mount('TodayDisclosure', { title: 'Practice', children: 'draft' });
  assert.equal(ui.nodes().length, 3); ui.press('Practice'); ui.press('Practice');
  assert.ok(ui.nodes().some(n => n.props.style?.display === 'none'));
});

test('both Today tiers lead with the call and check-in, then one next step, needs and the tucked-away sections', () => {
  const source = readFileSync(new URL('../app/(tabs)/index.tsx', import.meta.url), 'utf8');
  const all = source.split('<ScreenContainer').slice(1);
  // The bereaved Today: immediate help, then the grief card, then the call and her check-in.
  const bereaved = all.filter((screen) => screen.includes('<GriefCard'));
  assert.equal(bereaved.length, 1);
  assert.ok(bereaved[0].indexOf('<NeedsRouter') < bereaved[0].indexOf('<GriefCard'));
  assert.ok(bereaved[0].indexOf('<GriefCard') < bereaved[0].indexOf('{mondayCallCard}'));
  assert.ok(bereaved[0].indexOf('{mondayCallCard}') < bereaved[0].indexOf('{checkInCard}'));
  const screens = all.filter((screen) => !screen.includes('<GriefCard') && screen.includes('{checkInCard}')); assert.equal(screens.length, 2);
  for (const screen of screens) {
    // Greeting, the free Monday call (saving a seat is a new member's first
    // step), the check-in and its feedback, ONE next step, "What do you need
    // right now?", then the collapsed sections.
    const order = ['{header}', '{mondayCallCard}', '{checkInCard}', '<CheckInFeedbackCard', '...nextStepSlot', '<NeedsRouter', '...moreForThisWeek', 'disclosure.pathway', 'disclosure.invite', '<PassItOnCard', 'disclosure.practice', '<MoodChart'];
    const at = order.map((piece) => screen.indexOf(piece));
    assert.ok(at.every((index) => index >= 0), `missing: ${order.filter((_, i) => at[i] < 0).join(', ')}`);
    assert.deepEqual(at, [...at].sort((a, b) => a - b), 'Today order');
    // The cards that compete for the slot are never also stacked on the screen.
    for (const card of ['{willingnessWindowAlert}', '{lovedOneCheckCard}', '{holidayCard}', '{invitationCard}', '<GuidedStartPanel']) {
      assert.ok(!screen.includes(card), `${card} only through the next-step slot`);
    }
  }
  // Paid-only cards stay where they were, inside the practice section, on the paid Today only.
  const paid = screens.filter((screen) => screen.includes('<HeroCard'));
  assert.equal(paid.length, 1);
  const paidOrder = ['disclosure.practice', '<HeroCard', '<HoldLogCard', '<ContinueLetterCard', '<WeekReviewCard', '<MoodChart'].map((piece) => paid[0].indexOf(piece));
  assert.deepEqual(paidOrder, [...paidOrder].sort((a, b) => a - b));
  const free = screens.find((screen) => !screen.includes('<HeroCard'));
  for (const card of ['<ContinueLetterCard', '<WeekReviewCard']) assert.ok(!free.includes(card));
  assert.ok(free.includes('<FreeTierPaywall'));
  for (const lang of ['en', 'es']) {
    const locale = JSON.parse(readFileSync(new URL(`../src/locales/${lang}/today.json`, import.meta.url), 'utf8'));
    for (const key of ['progress', 'next', 'back', 'addNote', 'hideNote']) assert.ok(locale.checkIn[key]);
    assert.ok(locale.disclosure.practice); assert.ok(locale.needs.more);
    // The share card's section says what it is; the old "Free Monday call & connection" title is gone.
    assert.match(locale.disclosure.invite, /Family Squares/); assert.equal(locale.disclosure.connection, undefined);
    assert.ok(locale.disclosure.more);
  }
});
