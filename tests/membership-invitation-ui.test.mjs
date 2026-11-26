import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Executes the real component and its effects; not a native renderer/layout test.
const source = readFileSync(new URL('../src/membershipInvitations/ContextualMembershipInvitation.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
const settle = () => new Promise(resolve => setImmediate(resolve));
// The card's words come from the plans namespace; the tests read the real English file.
const plans = JSON.parse(readFileSync(new URL('../src/locales/en/plans.json', import.meta.url), 'utf8'));
const translate = (key, options = {}) => String(key.split('.').reduce((node, part) => node?.[part], plans) ?? key)
  .replace(/\{\{(\w+)\}\}/g, (_, name) => String(options[name]));
function mount({ completed = false, account = {}, delayed = false, placement = 'practice-completed', claimAnswers = [], trial = null } = {}) {
  let state = { user: { id: 'a', joinedAt: '2026-01-01T00:00:00.000Z' }, isAuthenticated: true, isLoading: false, accountError: null, isOfflineAccountFallback: false, entitlementsSettled: true, isAdmin: false, isAttached: false, accountState: 'direct-free', ...account };
  let props = { accountId: 'a', completed, placement };
  const slots = [], pending = [], claims = [], releases = [], dismissals = [], taps = [], routes = [], logged = [], showing = [];
  let cursor = 0, tree, resolveClaim;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useEffect(fn, deps) { const i = cursor++; const old = slots[i]; if (!old || deps.some((d, j) => !Object.is(d, old.deps[j]))) { pending.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); } },
  };
  const policy = {
    claim(...args) { claims.push(args); return delayed ? new Promise(resolve => { resolveClaim = resolve; }) : Promise.resolve(claimAnswers.length ? claimAnswers.shift() : true); },
    release(id) { releases.push(id); },
    dismiss(...args) { dismissals.push(args); return Promise.resolve(true); },
    tapped(...args) { taps.push(args); return Promise.resolve(true); },
  };
  const require = id => {
    if (id === 'react') return React;
    if (id === 'react-native') return { View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: v => v } };
    if (id === '@react-native-async-storage/async-storage') return {};
    if (id === 'expo-router') return { useRouter: () => ({ push: route => { routes.push(route); } }) };
    if (id === 'react-i18next') return { useTranslation: ns => { assert.equal(ns, 'plans'); return { t: translate, i18n: { language: 'en' } }; } };
    if (id.endsWith('lib/funnel')) return { logMembershipPath: (stage, meta) => { logged.push([stage, { ...meta }]); } };
    if (id.endsWith('lib/membershipPath')) return { plansHref: source => ({ pathname: '/plans', params: { source } }) };
    if (id.endsWith('AccountContext')) return { useAccount: () => state };
    if (id === './policy') return { createInvitationPolicy: () => policy };
    // One ask per visit is decided in the policy (tests/membership-invitations.test.ts);
    // the card reports when it is on screen, so the other asks give way.
    if (id === './visitAsks') return { askedThisVisit: () => false, noteInvitationShowing: (id, on) => { showing.push([id, on]); } };
    // What the App Store says about a free trial for Essential (null: none, or not known).
    if (id.endsWith('hooks/usePlanPurchase')) return { usePlanOffers: () => ({ trialLabel: tier => (tier === 'essential' ? trial : null) }) };
    throw Error(`Unexpected import ${id}`);
  };
  const exports = {}; new Function('require', 'exports', compiled)(require, exports);
  const flatten = n => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(flatten) : [n, ...flatten(n.props.children)];
  const text = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join(' ') : n?.props ? text(n.props.children) : '';
  const api = {
    claims, releases, dismissals, taps, routes, logged, showing,
    text: () => text(tree),
    // The trial line is its own small component: render it as the card would.
    trialText: () => { const node = flatten(tree).find(n => typeof n.type === 'function'); return node ? text(node.type()) : null; },
    buttons: () => flatten(tree).filter(n => n.type === 'Pressable'),
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
  // Logged once when it appears: the place it appeared, and nothing else.
  assert.deepEqual(ui.logged, [['membership_invite_shown', { source: 'practice_completed' }]]);
  for (const button of ui.buttons()) {
    assert.equal(button.props.accessibilityRole, 'button');
    assert.ok(button.props.accessibilityLabel);
  }
  ui.render({ completed: false }); assert.equal(ui.visible(), false);
  assert.equal(hydrated.logged.length, 0);
});

const ELIGIBLE = { user: { id: 'a', joinedAt: '2026-01-01T00:00:00.000Z' }, isAuthenticated: true, isLoading: false, accountError: null, isOfflineAccountFallback: false, entitlementsSettled: true, isAdmin: false, isAttached: false, accountState: 'direct-free' };
test('eligibility gates suppress claims, and someone who simply may not see it is never shown it later', async () => {
  for (const account of [{ user: null }, { user: { id: 'b' } }, { isAuthenticated: false }, { isAdmin: true }, { isAttached: true }, { accountState: 'direct-essential' }]) {
    const ui = mount({ account }); ui.render({ completed: true }); await settle(); ui.render();
    assert.equal(ui.claims.length, 0, JSON.stringify(account)); assert.equal(ui.visible(), false);
    assert.equal(ui.logged.length, 0, 'nothing is logged for someone who is never shown it');
    ui.render({}, ELIGIBLE); await settle(); ui.render();
    assert.equal(ui.claims.length, 0, `${JSON.stringify(account)}: not replayed`);
  }
});

// L3: the moment used to be lost for good when it arrived before the account was known.
test('a moment that arrives while the account is still loading (or offline) is kept, and claimed once the account is known', async () => {
  // entitlementsSettled false: a web or store membership is still syncing (she may be a member).
  for (const account of [{ isLoading: true }, { isOfflineAccountFallback: true }, { accountError: 'error' }, { entitlementsSettled: false }]) {
    const ui = mount({ placement: 'after-meeting', account }); ui.render({ completed: true }); await settle(); ui.render();
    assert.equal(ui.claims.length, 0, JSON.stringify(account)); assert.equal(ui.visible(), false);
    ui.render({}, ELIGIBLE); await settle(); ui.render();
    assert.equal(ui.claims.length, 1, `${JSON.stringify(account)}: claimed when the account settles`);
    assert.equal(ui.visible(), true);
    assert.deepEqual(ui.logged, [['membership_invite_shown', { source: 'after_meeting' }]]);
    ui.render(); assert.equal(ui.claims.length, 1, 'once');
  }
  // The moment ended before the account settled: nothing is kept.
  const gone = mount({ account: { isLoading: true } }); gone.render({ completed: true }); gone.render({ completed: false });
  gone.render({}, ELIGIBLE); gone.render({ completed: true }); await settle(); gone.render();
  assert.equal(gone.claims.length, 1, 'only the new moment claims');
  // The account settles as one that may not see it: nothing is kept for later either.
  for (const settledAs of [{ accountState: 'direct-essential' }, { isAdmin: true }]) {
    const ui = mount({ account: { isLoading: true } }); ui.render({ completed: true });
    ui.render({}, { ...ELIGIBLE, ...settledAs }); await settle(); ui.render();
    assert.equal(ui.claims.length, 0, JSON.stringify(settledAs));
    ui.render({}, ELIGIBLE); await settle(); ui.render();
    assert.equal(ui.claims.length, 0, `${JSON.stringify(settledAs)}: not replayed`);
  }
  // Completion already true when the screen opened is still never a moment, loading or not.
  const hydrated = mount({ completed: true, account: { isLoading: true } }); hydrated.render({}, ELIGIBLE); await settle(); hydrated.render();
  assert.equal(hydrated.claims.length, 0);
});

// 4.4: the bereavement feature was removed, so nothing else gates the card (and nothing waits on it).
test('who may see it is decided by the account alone, and a card on screen goes away when that changes', async () => {
  const ui = mount(); ui.render({ completed: true }); await settle(); ui.render();
  assert.equal(ui.visible(), true);
  ui.render({}, { accountState: 'direct-essential' }); ui.render();
  assert.equal(ui.visible(), false); assert.deepEqual(ui.releases, ['a']);
  assert.match(source, /const settled = !account\.isLoading && !account\.accountError && !account\.isOfflineAccountFallback &&\s+account\.entitlementsSettled;/);
  assert.match(source, /account\.accountState === 'direct-free';/);
  assert.doesNotMatch(source, /bereav/i);
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
    assert.equal(ui.logged.length, 0, `${change}: never shown, never logged`);
  }
});

test('dismiss controls are explicit; explore only navigates and stale explore cannot navigate', async () => {
  for (const [label, permanent] of [['Not now', false], ['Don’t show again', true]]) {
    const ui = mount(); ui.render({ completed: true }); await settle(); ui.render();
    ui.button(label)(); ui.render(); assert.equal(ui.visible(), false);
    assert.deepEqual(ui.dismissals[0].slice(0, 2), ['a', permanent]); assert.deepEqual(ui.routes, []);
  }
  const ui = mount(); ui.render({ completed: true }); await settle(); ui.render();
  // "See plans" opens the plans screen and says which invitation she came from.
  const plansRoute = [{ pathname: '/plans', params: { source: 'practice_completed' } }];
  const explore = ui.button('See plans'); assert.deepEqual(ui.routes, []);
  explore(); assert.deepEqual(ui.routes, plansRoute);
  assert.deepEqual(ui.logged.map(entry => entry[0]), ['membership_invite_shown', 'membership_invite_tapped']);
  assert.deepEqual(ui.logged[1][1], { source: 'practice_completed' });
  ui.render({}, { user: { id: 'b' } }); explore(); assert.deepEqual(ui.routes, plansRoute);
  assert.equal(ui.logged.length, 2, 'a stale tap is not logged');
});

test('after Family Squares: its own words, the after_meeting source, and the same limits', async () => {
  const ui = mount({ placement: 'after-meeting' }); ui.render({ completed: true }); await settle(); ui.render();
  assert.equal(ui.visible(), true);
  assert.deepEqual(ui.claims[0].slice(0, 2), ['a', 'after-meeting']);
  assert.match(ui.text(), /Keep talking between Mondays/);
  assert.match(ui.text(), /message a coach on the days in between/);
  assert.doesNotMatch(ui.text(), /\$|soberhelpline|website/i);
  assert.deepEqual(ui.logged, [['membership_invite_shown', { source: 'after_meeting' }]]);
  ui.button('See plans')();
  assert.deepEqual(ui.routes, [{ pathname: '/plans', params: { source: 'after_meeting' } }]);
  // Paid, provider-covered and admin accounts never see it, whatever the moment.
  for (const account of [{ accountState: 'direct-essential' }, { accountState: 'direct-premium' }, { isAttached: true, accountState: 'attached' }, { isAdmin: true }]) {
    const other = mount({ placement: 'after-meeting', account }); other.render({ completed: true }); await settle(); other.render();
    assert.equal(other.claims.length, 0, JSON.stringify(account)); assert.equal(other.visible(), false);
  }
});

test('an ignored card gives its claim back when the moment ends, and cannot reappear without a new claim', async () => {
  // First return from the meeting: claimed and shown. Second: the policy says no (14-day limit).
  const ui = mount({ placement: 'after-meeting', claimAnswers: [true, false] });
  ui.render({ completed: true }); await settle(); ui.render();
  assert.equal(ui.visible(), true); assert.deepEqual(ui.releases, []);
  // She ignores it and leaves the app: the moment is over.
  ui.render({ completed: false }); ui.render();
  assert.equal(ui.visible(), false);
  assert.deepEqual(ui.releases, ['a'], 'the visible claim is released, so other placements are not starved');
  // Next Monday in the same app process (Today never unmounts).
  ui.render({ completed: true }); await settle(); ui.render();
  assert.equal(ui.claims.length, 2, 'it asks the policy again');
  assert.equal(ui.visible(), false, 'refused by the policy: nothing is shown');
  assert.equal(ui.logged.length, 1, 'shown (and logged) once only');
  assert.deepEqual(ui.releases, ['a'], 'nothing was claimed the second time, so nothing more to release');
  ui.unmount(); assert.deepEqual(ui.releases, ['a']);
});

test('losing eligibility while the card shows also gives the claim back, once', async () => {
  const ui = mount(); ui.render({ completed: true }); await settle(); ui.render();
  assert.equal(ui.visible(), true);
  ui.render({}, { accountState: 'direct-essential' }); ui.render();
  assert.equal(ui.visible(), false); assert.deepEqual(ui.releases, ['a']);
  ui.unmount(); assert.deepEqual(ui.releases, ['a']);
});

test('the claim carries when her account began, and nothing else about her', async () => {
  const ui = mount(); ui.render({ completed: true }); await settle(); ui.render();
  assert.deepEqual(ui.claims[0][3], { joinedAt: Date.parse('2026-01-01T00:00:00.000Z') });
  // Unknown: the policy treats her as new.
  for (const user of [{ id: 'a' }, { id: 'a', joinedAt: 'not a date' }]) {
    const other = mount({ account: { user } }); other.render({ completed: true }); await settle(); other.render();
    assert.deepEqual(other.claims[0][3], { joinedAt: null }, JSON.stringify(user));
  }
});

test('tapping "See plans" is an answer: the policy hears it, and the card goes', async () => {
  const ui = mount({ placement: 'tool-finished' }); ui.render({ completed: true }); await settle(); ui.render();
  ui.button('See plans')(); ui.render();
  assert.equal(ui.visible(), false);
  assert.deepEqual(ui.taps.map(tap => tap[0]), ['a']);
  assert.deepEqual(ui.routes, [{ pathname: '/plans', params: { source: 'tool_finished' } }]);
});

test('finishing a tool and five days of check-ins: their own true lines and sources', async () => {
  const tool = mount({ placement: 'tool-finished' }); tool.render({ completed: true }); await settle(); tool.render();
  assert.match(tool.text(), /message a coach between meetings/);
  assert.deepEqual(tool.logged, [['membership_invite_shown', { source: 'tool_finished' }]]);
  const week = mount({ placement: 'checkin-week' }); week.render({ completed: true }); await settle(); week.render();
  assert.match(week.text(), /Five days in a row/);
  assert.match(week.text(), /week in review and their progress here on Today/);
  assert.deepEqual(week.logged, [['membership_invite_shown', { source: 'checkin_week' }]]);
  week.button('See plans')();
  assert.deepEqual(week.routes, [{ pathname: '/plans', params: { source: 'checkin_week' } }]);
  for (const ui of [tool, week]) assert.doesNotMatch(ui.text(), /\$|\d+[.,]\d{2}|soberhelpline|website/i);
  // Never for a member or a covered account.
  for (const placement of ['tool-finished', 'checkin-week']) {
    for (const account of [{ accountState: 'direct-essential' }, { isAttached: true, accountState: 'attached' }]) {
      const other = mount({ placement, account }); other.render({ completed: true }); await settle(); other.render();
      assert.equal(other.claims.length, 0, `${placement} ${JSON.stringify(account)}`); assert.equal(other.visible(), false);
    }
  }
});

test('a free trial is said once, only when the App Store offers one', async () => {
  const withTrial = mount({ trial: '7-day free trial' }); withTrial.render({ completed: true }); await settle(); withTrial.render();
  assert.equal(withTrial.trialText(), 'Essential starts with a 7-day free trial.');
  const without = mount(); without.render({ completed: true }); await settle(); without.render();
  assert.equal(without.trialText(), '', 'no trial, or not known: nothing about a trial');
  assert.doesNotMatch(without.text(), /trial/i);
  assert.match(source, /const trial = usePlanOffers\(\)\.trialLabel\('essential'\);/);
});

// One ask per visit, the other way: the card says when it is on screen, so the
// rating prompt and the reminder asks give way (visitAsks.invitationThisVisit).
test('the card reports itself on screen while it shows, and off when it goes', async () => {
  const ui = mount(); ui.render({ completed: true }); await settle(); ui.render();
  assert.equal(ui.visible(), true);
  assert.deepEqual(ui.showing, [['a', true]]);
  ui.button('Not now')(); ui.render();
  assert.equal(ui.visible(), false);
  assert.deepEqual(ui.showing, [['a', true], ['a', false]]);
  // Never reported for a card that never showed.
  const none = mount({ account: { accountState: 'direct-essential' } }); none.render({ completed: true }); await settle(); none.render();
  assert.deepEqual(none.showing, []);
  // Unmounting with the card up reports it gone.
  const up = mount(); up.render({ completed: true }); await settle(); up.render(); up.unmount();
  assert.deepEqual(up.showing, [['a', true], ['a', false]]);
});
