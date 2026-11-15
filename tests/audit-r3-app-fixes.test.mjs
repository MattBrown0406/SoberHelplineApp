import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Audit round 3 (app side): runs the real source with small doubles for the
// network, the device store and React.
const root = new URL('../', import.meta.url);
const source = (path) => fs.readFileSync(new URL(path, root), 'utf8');
function load(path, imports = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: (id) => {
    if (id in imports) return imports[id];
    throw Error(`Unexpected import ${id}`);
  }, Date, Intl, console, Promise, setTimeout, clearTimeout, ...globals });
  return module.exports;
}
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const plain = (value) => JSON.parse(JSON.stringify(value));

// A clock the test can move. Tuesday 2026-11-17, 9:00 AM Pacific: the coming meeting is Monday the 23rd.
function clock(start = '2026-11-17T17:00:00Z') {
  const state = { now: Date.parse(start) };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [state.now])); } static now() { return state.now; } }
  return { Clock, set(at) { state.now = Date.parse(at); } };
}
const THIS_WEEK = '2026-11-23', NEXT_WEEK = '2026-11-30';
// The Tuesday after: the coming meeting is Monday the 30th.
const A_WEEK_LATER = '2026-11-24T17:00:00Z';

function cancelledLib(rpc, time = clock()) {
  const calls = [];
  const lib = load('src/lib/familySquaresCancelled.ts', {
    './supabase': { supabase: { rpc: (name, args) => { calls.push([name, plain(args)]); return rpc(); } } },
    '../../supabase/functions/_shared/family-squares-time': load('supabase/functions/_shared/family-squares-time.ts', {}, { Date: time.Clock }),
  }, { Date: time.Clock });
  return { lib, calls, time };
}

// ── M1: a cancelled week is the DATE that was cancelled ─────────────────────

test('M1: a cancelled date counts only for the coming meeting; last week\'s is "not cancelled"', async () => {
  const h = cancelledLib(async () => ({ data: true, error: null }));
  assert.equal(await h.lib.loadFamilySquaresCancelledDate(), THIS_WEEK);
  assert.equal(h.lib.isCancelledMeetingDate(THIS_WEEK), true);
  for (const other of [null, undefined, '', true, 1, '2026-11-16', NEXT_WEEK]) assert.equal(h.lib.isCancelledMeetingDate(other), false, String(other));
  // She left the app open on Support in the cancelled week and opens it the Monday after.
  h.time.set('2026-11-30T20:00:00Z');
  assert.equal(h.lib.comingFamilySquaresMeetingDate(), NEXT_WEEK);
  assert.equal(h.lib.isCancelledMeetingDate(THIS_WEEK), false, 'the stored answer no longer speaks for the meeting that is coming');
  assert.equal(h.lib.isFamilySquaresKnownCancelled(), false);
});

test('M1: any doubt is null, and the older yes/no reader answers the same', async () => {
  for (const rpc of [
    async () => ({ data: null, error: { message: 'down' } }), async () => { throw Error('offline'); }, () => { throw Error('no client'); },
    async () => ({ data: 'true', error: null }), async () => ({ data: false, error: null }), async () => undefined,
  ]) {
    const h = cancelledLib(rpc);
    assert.equal(await h.lib.loadFamilySquaresCancelledDate(), null, String(rpc));
    assert.equal(await h.lib.loadFamilySquaresCancelled(), false);
  }
  const yes = cancelledLib(async () => ({ data: true, error: null }));
  assert.equal(await yes.lib.loadFamilySquaresCancelled(), true);
});

// ── M3: the website's reason travels with the refusal ───────────────────────

const httpError = (body) => ({ context: { clone: () => ({ json: async () => body }) } });
function registration(invoke) {
  const time = clock();
  const cancelled = cancelledLib(async () => ({ data: false, error: null }), time);
  const api = { auth: { getSession: async () => ({ data: { session: { user: { id: 'auth-A' }, access_token: 'token-A' } } }) }, from() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { id: 'account-A' } }) }; }, functions: { invoke } };
  const lib = load('src/lib/familySquaresRegistration.ts', {
    './supabase': { supabase: api },
    '../../supabase/functions/_shared/family-squares-time': load('supabase/functions/_shared/family-squares-time.ts', {}, { Date: time.Clock }),
    './familySquaresCancelled': cancelled.lib,
    './familySquaresCard': load('src/lib/familySquaresCard.ts', {}),
  }, { Date: time.Clock });
  return { lib, cancelled: cancelled.lib };
}

test('M3: "meeting_cancelled" is passed on and marks that date cancelled on the device', async () => {
  const off = registration(async () => ({ data: null, error: httpError({ ok: false, error: 'website_declined', reason: 'meeting_cancelled' }) }));
  assert.equal(off.cancelled.isFamilySquaresKnownCancelled(), false);
  assert.deepEqual(plain(await off.lib.reserveFamilySquares('account-A')), { ok: false, reason: 'website_declined', websiteReason: 'meeting_cancelled' });
  assert.equal(off.cancelled.isFamilySquaresKnownCancelled(), true, 'onboarding and every other screen know without asking');
  assert.equal(off.cancelled.isFamilySquaresKnownCancelled(new Date(A_WEEK_LATER)), false, 'for that date only');
  // The other reason, an unknown one and none at all (an older server) mark nothing.
  for (const [body, expected] of [
    [{ ok: false, error: 'website_declined', reason: 'registration_unavailable' }, { ok: false, reason: 'website_declined', websiteReason: 'registration_unavailable' }],
    [{ ok: false, error: 'website_declined', reason: 'something_new' }, { ok: false, reason: 'website_declined' }],
    [{ ok: false, error: 'website_declined' }, { ok: false, reason: 'website_declined' }],
    // A reason on any other error means nothing.
    [{ ok: false, error: 'retry', reason: 'meeting_cancelled' }, { ok: false }],
  ]) {
    const h = registration(async () => ({ data: null, error: httpError(body) }));
    assert.deepEqual(plain(await h.lib.reserveFamilySquares('account-A')), expected, JSON.stringify(body));
    assert.equal(h.cancelled.isFamilySquaresKnownCancelled(), false);
  }
});

// ── The Today and Support hooks ─────────────────────────────────────────────

const FS_ROW = { id: 'english-session', kind: 'group', title: 'The Family Squares', schedule_label: '', next_at: null, zoom_url: null };
function hooks(which, options = {}) {
  const alerts = [], states = [], reads = [], appState = { listener: null };
  const world = { reserve: options.reserve ?? { ok: true, alreadyRegistered: false }, cancelledDate: options.cancelledDate ?? null, failing: null, knownCancelled: options.knownCancelled ?? false, coming: THIS_WEEK };
  let slot = 0;
  const react = { useState: (initial) => { const index = slot++; states[index] = initial; return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; }, useCallback: (fn) => fn, useEffect(fn) { fn(); }, useRef: (value) => ({ current: value }) };
  const from = (table) => {
    const chain = { select() { return chain; }, in() { return chain; }, order() { return chain; }, eq() { return chain; },
      then(resolve, reject) {
        reads.push(table);
        const failed = world.failing === table;
        return Promise.resolve({ data: failed ? null : table === 'sessions' ? [FS_ROW] : [], count: 1, error: failed ? { message: 'offline' } : null }).then(resolve, reject);
      } };
    return chain;
  };
  const imports = {
    react, 'react-native': { AppState: { addEventListener: (_, listener) => { appState.listener = listener; return { remove() {} }; } } },
    'expo-router': { useFocusEffect() {} }, 'react-i18next': { useTranslation: () => ({ i18n: { language: 'en' } }) }, i18next: { default: { t: (v) => v } },
    '../lib/supabase': { supabase: { from, rpc: async () => ({ data: null, error: null }) } },
    '../lib/familySquaresSchedule': load('src/lib/familySquaresSchedule.ts'),
    '../lib/laSobremesa': { reserveLaSobremesa: async () => { throw Error('unexpected Spanish registration'); }, withPersonalLinks: async (rows) => rows },
    '../lib/appAlert': { appAlert: (...args) => alerts.push(args) },
    '../lib/familySquaresRegistration': { reserveFamilySquares: async () => world.reserve, familySquaresRsvpIsCurrent: () => false, FAMILY_SQUARES_ALREADY_REGISTERED: 'common:familySquares.alreadyRegistered' },
    '../lib/familySquaresSeat': { declineFamilySquares: async () => true },
    '../lib/freshAnswer': load('src/lib/freshAnswer.ts', {}),
    '../lib/familySquaresSessionCache': { rememberFamilySquaresSession() {} },
    '../lib/familySquaresCancelled': {
      loadFamilySquaresCancelledDate: async () => world.cancelledDate,
      isCancelledMeetingDate: (date) => typeof date === 'string' && date === world.coming,
      comingFamilySquaresMeetingDate: () => world.coming,
      isFamilySquaresKnownCancelled: () => world.knownCancelled,
    },
    '../lib/familySquaresCard': load('src/lib/familySquaresCard.ts', {}),
    '../lib/situation': { DEFAULT_SITUATION: {}, funnelDoor: () => '' },
    '../content/curriculum': { phaseForWeek: () => '', isBeyondAuthoredCurriculum: () => false, curriculumWeek: () => 1 },
  };
  const module = load(which === 'today' ? 'src/hooks/useTodayFeed.ts' : 'src/hooks/useSessions.ts', imports, { console: { ...console, warn() {} } });
  const hook = which === 'today' ? module.useTodayFeed('account-A', null) : module.useSessions('account-A');
  // (useTodayFeed's states: nextFreeCall is the 9th; useSessions: sessions is the 1st, "returns" the 4th.)
  return { hook, alerts, states, reads, world, appState, card: () => (which === 'today' ? states[8] : states[0][0]) };
}
// The hook as a render would hand it out again, with the card now in its state.
function todayTap(h) {
  const react = { useState: (() => { let slot = 0; return (initial) => { const index = slot++; if (!(index in h.states)) h.states[index] = initial; return [h.states[index], (next) => { h.states[index] = typeof next === 'function' ? next(h.states[index]) : next; }]; }; })(), useCallback: (fn) => fn, useEffect() {}, useRef: (value) => ({ current: value }) };
  return react;
}

test('M1: Today keeps the card when a read fails, but never an earlier "cancelled"', async () => {
  const h = hooks('today', { cancelledDate: THIS_WEEK });
  await settle();
  assert.equal(h.card().cancelledDate, THIS_WEEK, 'a clean answer: cancelled, for that date');
  assert.equal(h.card().id, 'english-session');
  // The next read fails (offline resume), and so does the cancelled check: fail open.
  h.world.failing = 'walls'; h.world.cancelledDate = null;
  await h.hook.reload(); await settle();
  assert.equal(h.card().id, 'english-session', 'the card she had is kept');
  assert.equal(h.card().cancelledDate, null, 'but it no longer says the meeting is off');
  // A failed read whose cancelled check DID answer cleanly keeps that fresh answer.
  h.world.cancelledDate = THIS_WEEK;
  await h.hook.reload(); await settle();
  assert.equal(h.card().cancelledDate, THIS_WEEK);
  // And a good read replaces everything as before.
  h.world.failing = null; h.world.cancelledDate = null;
  await h.hook.reload(); await settle();
  assert.equal(h.card().cancelledDate, null);
});

test('M1: Support reads again, and is drawn again at once, when the app returns to the front', async () => {
  const h = hooks('support', { cancelledDate: THIS_WEEK });
  await settle();
  assert.equal(h.card().cancelledDate, THIS_WEEK);
  const before = h.reads.length, returnsBefore = h.states[3];
  h.appState.listener('background'); h.appState.listener('inactive');
  assert.equal(h.reads.length, before, 'only a return to the front reads again');
  // The Monday after: the website has nothing cancelled.
  h.world.cancelledDate = null; h.world.coming = NEXT_WEEK;
  h.appState.listener('active');
  assert.equal(h.states[3], returnsBefore + 1, 'drawn again straight away, before the read lands');
  await settle();
  assert.ok(h.reads.length > before);
  assert.equal(h.card().cancelledDate, null);
});

test('M3: Today shows the cancelled line the moment the website says the meeting is cancelled', async () => {
  const h = hooks('today', { reserve: { ok: false, reason: 'website_declined', websiteReason: 'meeting_cancelled' } });
  await settle();
  assert.equal(h.card().cancelledDate, null, 'nothing had said so yet');
  const readsBefore = h.reads.length;
  const again = load('src/hooks/useTodayFeed.ts', { ...todayImports(h), react: todayTap(h) }, { console: { ...console, warn() {} } }).useTodayFeed('account-A', null);
  await again.rsvpFreeCall(); await settle();
  assert.deepEqual(h.alerts, [['support:sessions.rsvpErrorTitle', 'common:familySquares.cancelled.line']]);
  assert.equal(h.card().cancelledDate, THIS_WEEK, 'the card now shows the calm line, with no Save and no Join');
  assert.equal(h.reads.length, readsBefore, 'nothing to look up: the website has answered');
});

test('M3: "registration_unavailable" says so even in a week the device thinks is cancelled, and looks again', async () => {
  const h = hooks('today', { reserve: { ok: false, reason: 'website_declined', websiteReason: 'registration_unavailable' }, knownCancelled: true });
  await settle();
  const readsBefore = h.reads.length;
  const again = load('src/hooks/useTodayFeed.ts', { ...todayImports(h), react: todayTap(h) }, { console: { ...console, warn() {} } }).useTodayFeed('account-A', null);
  await again.rsvpFreeCall(); await settle();
  assert.deepEqual(h.alerts, [['support:sessions.rsvpErrorTitle', 'common:familySquares.registrationUnavailable']]);
  assert.ok(h.reads.length > readsBefore);
});
// The same doubles the first render used (so the second render shares its world).
function todayImports(h) {
  return {
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
    'expo-router': { useFocusEffect() {} }, 'react-i18next': { useTranslation: () => ({ i18n: { language: 'en' } }) }, i18next: { default: { t: (v) => v } },
    '../lib/supabase': { supabase: { from: (table) => { const chain = { select() { return chain; }, in() { return chain; }, order() { return chain; }, eq() { return chain; }, then(resolve, reject) { h.reads.push(table); return Promise.resolve({ data: table === 'sessions' ? [FS_ROW] : [], count: 1, error: null }).then(resolve, reject); } }; return chain; }, rpc: async () => ({ data: null, error: null }) } },
    '../lib/familySquaresSchedule': load('src/lib/familySquaresSchedule.ts'),
    '../lib/laSobremesa': { reserveLaSobremesa: async () => { throw Error('unexpected Spanish registration'); }, withPersonalLinks: async (rows) => rows },
    '../lib/appAlert': { appAlert: (...args) => h.alerts.push(args) },
    '../lib/familySquaresRegistration': { reserveFamilySquares: async () => h.world.reserve, familySquaresRsvpIsCurrent: () => false, FAMILY_SQUARES_ALREADY_REGISTERED: 'common:familySquares.alreadyRegistered' },
    '../lib/familySquaresSeat': { declineFamilySquares: async () => true },
    '../lib/freshAnswer': load('src/lib/freshAnswer.ts', {}),
    '../lib/familySquaresSessionCache': { rememberFamilySquaresSession() {} },
    '../lib/familySquaresCancelled': { loadFamilySquaresCancelledDate: async () => h.world.cancelledDate, isCancelledMeetingDate: (date) => typeof date === 'string' && date === h.world.coming, comingFamilySquaresMeetingDate: () => h.world.coming, isFamilySquaresKnownCancelled: () => h.world.knownCancelled },
    '../lib/familySquaresCard': load('src/lib/familySquaresCard.ts', {}),
    '../lib/situation': { DEFAULT_SITUATION: {}, funnelDoor: () => '' },
    '../content/curriculum': { phaseForWeek: () => '', isBeyondAuthoredCurriculum: () => false, curriculumWeek: () => 1 },
  };
}

test('M3: Support reports the website\'s reason, and a cancelled meeting shows on the row at once', async () => {
  const off = hooks('support', { reserve: { ok: false, reason: 'website_declined', websiteReason: 'meeting_cancelled' } });
  await settle();
  const before = off.reads.length;
  assert.equal(await off.hook.toggleRsvp(off.card()), 'meeting_cancelled'); await settle();
  assert.equal(off.card().cancelledDate, THIS_WEEK);
  assert.equal(off.reads.length, before);
  const unavailable = hooks('support', { reserve: { ok: false, reason: 'website_declined', websiteReason: 'registration_unavailable' } });
  await settle();
  assert.equal(await unavailable.hook.toggleRsvp(unavailable.card()), 'registration_unavailable');
  // An older server gives no reason: reported as before, and the list is read again.
  const older = hooks('support', { reserve: { ok: false, reason: 'website_declined' } });
  await settle();
  const olderBefore = older.reads.length;
  assert.equal(await older.hook.toggleRsvp(older.card()), 'website_declined'); await settle();
  assert.ok(older.reads.length > olderBefore);
  assert.equal(await hooks('support', { reserve: { ok: false } }).hook.toggleRsvp(FS_ROW), false);
});

// ── M2: what the Boundaries tab knows about the coming Monday ───────────────

function reactDouble() {
  const slots = [], effects = [];
  let cursor = 0;
  return {
    react: {
      useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (next) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
      useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
      useCallback(fn, deps) { const i = cursor++; const old = slots[i]; if (old && deps && !deps.some((dep, j) => dep !== old.deps[j])) return old.fn; slots[i] = { fn, deps }; return fn; },
      useEffect(fn, deps) { const i = cursor++; const old = slots[i]; if (!old || !deps || deps.some((dep, j) => dep !== old.deps[j])) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
    },
    render(hook) { cursor = 0; const result = hook(); effects.splice(0).forEach((run) => run()); return result; },
  };
}

function mondayWeek(world) {
  const r = reactDouble(), focus = { run: null }, queries = [];
  const hook = load('src/hooks/useMondayMeetingWeek.ts', {
    react: r.react,
    'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } },
    'expo-router': { useFocusEffect(callback) { focus.run = callback; } },
    '../lib/supabase': { supabase: { from: (table) => { const filters = []; const chain = { select() { return chain; }, eq(column, value) { filters.push([column, value]); return chain; }, then(resolve, reject) { queries.push([table, filters]); return Promise.resolve().then(() => world.rsvps()).then(resolve, reject); } }; return chain; } } },
    '../lib/familySquaresCancelled': {
      comingFamilySquaresMeetingDate: () => world.coming,
      isCancelledMeetingDate: (date) => typeof date === 'string' && date === world.coming,
      isFamilySquaresKnownCancelled: () => world.known ?? false,
      loadFamilySquaresCancelledDate: async () => world.cancelledDate ?? null,
    },
  }).useMondayMeetingWeek;
  const render = (enabled = true) => r.render(() => hook('account-A', enabled));
  return { render, queries, async open(enabled = true) { render(enabled); focus.run(); await settle(); return render(enabled); } };
}

test('M2: cancelled or "can\'t make it" for the coming Monday is known; any failed read is "show the line"', async () => {
  const declinedRow = { data: [{ family_squares_meeting_date: THIS_WEEK }], error: null };
  const on = mondayWeek({ coming: THIS_WEEK, rsvps: () => ({ data: [], error: null }) });
  assert.deepEqual(plain(await on.open()), { cancelled: false, declined: false });
  assert.deepEqual(plain(on.queries[0]), ['session_rsvps', [['account_id', 'account-A'], ['status', 'declined']]], 'her own "can\'t make it" answers only');
  assert.deepEqual(plain(await mondayWeek({ coming: THIS_WEEK, cancelledDate: THIS_WEEK, rsvps: () => ({ data: [], error: null }) }).open()), { cancelled: true, declined: false });
  assert.deepEqual(plain(await mondayWeek({ coming: THIS_WEEK, rsvps: () => declinedRow }).open()), { cancelled: false, declined: true });
  // An answer for another Monday is not an answer for this one.
  assert.deepEqual(plain(await mondayWeek({ coming: NEXT_WEEK, cancelledDate: THIS_WEEK, rsvps: () => declinedRow }).open()), { cancelled: false, declined: false });
  // Fail open.
  for (const rsvps of [() => ({ data: null, error: { message: 'offline' } }), () => { throw Error('offline'); }, () => ({ data: 'nope', error: null })]) {
    assert.deepEqual(plain(await mondayWeek({ coming: THIS_WEEK, rsvps }).open()), { cancelled: false, declined: false });
  }
  // Any day but meeting day: nothing is read, and nothing is claimed.
  const quiet = mondayWeek({ coming: THIS_WEEK, cancelledDate: THIS_WEEK, known: true, rsvps: () => declinedRow });
  assert.deepEqual(plain(await quiet.open(false)), { cancelled: false, declined: false });
  assert.equal(quiet.queries.length, 0);
  // Before this screen's own read lands, what Today was just told already counts.
  assert.equal(mondayWeek({ coming: THIS_WEEK, known: true, rsvps: () => ({ data: [], error: null }) }).render().cancelled, true);
});

// ── L5: the weekly-seat switch on the other tab ─────────────────────────────

test('L5: a change saved on another screen cannot be undone by a read that began before it', async () => {
  const r = reactDouble(), loads = [], focus = { run: null }, heard = { listener: null };
  const hook = load('src/hooks/useFamilySquaresWeeklySeat.ts', {
    react: r.react,
    'expo-router': { useFocusEffect(callback) { focus.run = callback; } },
    '../lib/familySquaresSeat': {
      loadWeeklySeat: () => { const d = deferred(); loads.push(d); return d.promise; },
      saveWeeklySeat: async () => true,
      subscribeWeeklySeat: (listener) => { heard.listener = listener; return () => {}; },
    },
  }).useFamilySquaresWeeklySeat;
  const render = () => r.render(() => hook('account-A'));
  render();
  loads[0].resolve(false); await settle();
  assert.equal(render().enabled, false);
  // Today comes into focus and starts a read; while it is in flight she turns the switch on in Settings.
  focus.run();
  heard.listener('account-A', true);
  assert.equal(render().enabled, true);
  loads[1].resolve(false); await settle();          // the old read lands afterwards with "off"
  assert.equal(render().enabled, true, 'the saved change stays');
  // A read that begins after the change is trusted again, and another account's change is ignored.
  focus.run(); loads[2].resolve(false); await settle();
  assert.equal(render().enabled, false);
  heard.listener('account-B', true);
  assert.equal(render().enabled, false);
});
