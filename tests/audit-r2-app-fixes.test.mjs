import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Audit round 2 (app side): runs the real source with small doubles for the
// network and the device store.
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
const settle = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const plain = (value) => JSON.parse(JSON.stringify(value));
function deviceStore(initial = {}) {
  const store = new Map(Object.entries(initial)), writes = [];
  return { store, writes, module: { __esModule: true, default: {
    getItem: async (key) => store.get(key) ?? null,
    setItem: async (key, value) => { writes.push([key, value]); store.set(key, value); },
    removeItem: async (key) => { writes.push([key, null]); store.delete(key); },
  } } };
}

// Monday 2026-11-16, 7:05 PM Pacific: the meeting is under way.
class MeetingTime extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-17T03:05:00Z'])); } static now() { return new Date().getTime(); } }
// Tuesday 2026-11-17, 9:00 AM Pacific: the coming meeting is Monday the 23rd.
class Tuesday extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-17T17:00:00Z'])); } static now() { return new Date().getTime(); } }
const timeAt = (Clock) => load('supabase/functions/_shared/family-squares-time.ts', {}, { Date: Clock });

// ── M4: a Monday the website cancelled ──────────────────────────────────────

function cancelledLib(rpc, Clock = Tuesday) {
  const calls = [];
  const lib = load('src/lib/familySquaresCancelled.ts', {
    './supabase': { supabase: { rpc: (name, args) => { calls.push([name, plain(args)]); return rpc(); } } },
    '../../supabase/functions/_shared/family-squares-time': timeAt(Clock),
  }, { Date: Clock });
  return { lib, calls };
}

test('the cancelled check asks about the coming meeting\'s Pacific date and fails open', async () => {
  const yes = cancelledLib(async () => ({ data: true, error: null }));
  assert.equal(await yes.lib.loadFamilySquaresCancelled(), true);
  assert.deepEqual(yes.calls, [['family_squares_meeting_cancelled', { p_meeting_date: '2026-11-23' }]]);
  // Monday evening, during the meeting: tonight's date, the one an RSVP is kept for.
  const tonight = cancelledLib(async () => ({ data: false, error: null }), MeetingTime);
  assert.equal(await tonight.lib.loadFamilySquaresCancelled(), false);
  assert.deepEqual(tonight.calls[0][1], { p_meeting_date: '2026-11-16' });
  assert.equal(tonight.lib.comingFamilySquaresMeetingDate(), '2026-11-16');
  // Any error, a server without the function yet, or anything but a plain `true`: not cancelled.
  for (const rpc of [
    async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }),
    async () => ({ data: true, error: { message: 'permission denied' } }),
    async () => { throw Error('offline'); },
    () => { throw Error('no client'); },
    async () => ({ data: 'true', error: null }), async () => ({ data: 1, error: null }),
    async () => ({ data: null, error: null }), async () => ({ data: { cancelled: true }, error: null }),
    async () => undefined, async () => ({ data: false, error: null }),
  ]) {
    const h = cancelledLib(rpc);
    assert.equal(await h.lib.loadFamilySquaresCancelled(), false, String(rpc));
    assert.equal(h.lib.isFamilySquaresKnownCancelled(), false);
  }
  const { meetingCancelledFrom } = yes.lib;
  assert.equal(meetingCancelledFrom({ data: true, error: null }), true);
  assert.equal(meetingCancelledFrom({ data: true }), true);
  assert.equal(meetingCancelledFrom(null), false);
});

test('a cancelled week is remembered for this run of the app, for that week only, until the server says otherwise', async () => {
  let answer = { data: true, error: null };
  const h = cancelledLib(async () => answer);
  assert.equal(h.lib.isFamilySquaresKnownCancelled(), false);
  await h.lib.loadFamilySquaresCancelled();
  assert.equal(h.lib.isFamilySquaresKnownCancelled(), true);
  assert.equal(h.lib.isFamilySquaresKnownCancelled(new Date('2026-11-24T17:00:00Z')), false, 'the week after is not cancelled with it');
  answer = { data: false, error: null };
  await h.lib.loadFamilySquaresCancelled();
  assert.equal(h.lib.isFamilySquaresKnownCancelled(), false, 'put back on');
});

function registration(invoke) {
  const api = { auth: { getSession: async () => ({ data: { session: { user: { id: 'auth-A' }, access_token: 'token-A' } } }) }, from() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { id: 'account-A' } }) }; }, functions: { invoke } };
  return load('src/lib/familySquaresRegistration.ts', { './supabase': { supabase: api }, '../../supabase/functions/_shared/family-squares-time': timeAt(Tuesday) }, { Date: Tuesday });
}
const httpError = (body) => ({ context: { clone: () => ({ json: async () => { if (body instanceof Error) throw body; return body; } }) } });

test('the website refusing a seat is told apart from a connection problem', async () => {
  const declined = registration(async () => ({ data: null, error: httpError({ ok: false, error: 'website_declined' }) }));
  assert.deepEqual(plain(await declined.reserveFamilySquares('account-A')), { ok: false, reason: 'website_declined' });
  // Every other failure stays an ordinary one: another 409, an outage, a body that cannot be read, no response at all.
  for (const error of [httpError({ ok: false, error: 'retry' }), httpError({ ok: false, error: 'unavailable' }), httpError(Error('not json')), httpError(null), { message: 'Network request failed' }, true]) {
    const lib = registration(async () => ({ data: null, error }));
    assert.deepEqual(plain(await lib.reserveFamilySquares('account-A')), { ok: false });
  }
  const ok = registration(async () => ({ data: { ok: true, already_registered: false, meeting_date: '2026-11-23' }, error: null }));
  assert.equal((await ok.reserveFamilySquares('account-A')).ok, true);
});

// The Today and Support hooks, with the seat save answered by the test.
function hooks(which, result, options = {}) {
  const alerts = [], states = [], reloads = [];
  const session = { id: 'english-session', title: 'The Family Squares', kind: 'group', rsvped: options.rsvped ?? false, zoom_url: null, next_at: null, cancelled: options.cardCancelled };
  let slot = 0;
  const react = { useState: (initial) => { const index = slot++; states[index] = which === 'today' && index === 8 ? session : initial; return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next; }]; }, useCallback: (fn) => fn, useEffect() {}, useRef: (value) => ({ current: value }) };
  const query = { select() { return this; }, in() { return this; }, order() { return this; }, eq() { return this; }, then(resolve, reject) { reloads.push(1); return Promise.resolve({ data: [], count: 1, error: null }).then(resolve, reject); } };
  const imports = { react, 'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } }, 'expo-router': { useFocusEffect() {} }, 'react-i18next': { useTranslation: () => ({ i18n: { language: 'en' } }) }, i18next: { default: { t: (v) => v } }, '../lib/supabase': { supabase: { from: () => query, rpc: async () => ({ data: null, error: null }) } }, '../lib/familySquaresSchedule': load('src/lib/familySquaresSchedule.ts'), '../lib/laSobremesa': { reserveLaSobremesa: async () => { throw Error('unexpected Spanish registration'); }, withPersonalLinks: async (rows) => rows }, '../lib/appAlert': { appAlert: (...args) => alerts.push(args) }, '../lib/familySquaresRegistration': { reserveFamilySquares: async () => result, familySquaresRsvpIsCurrent: () => false, FAMILY_SQUARES_ALREADY_REGISTERED: 'common:familySquares.alreadyRegistered' }, '../lib/familySquaresSeat': { declineFamilySquares: async () => true }, '../lib/freshAnswer': load('src/lib/freshAnswer.ts', {}), '../lib/familySquaresSessionCache': { rememberFamilySquaresSession() {} }, '../lib/familySquaresCancelled': { loadFamilySquaresCancelled: async () => false, isFamilySquaresKnownCancelled: () => options.knownCancelled ?? false }, '../lib/familySquaresCard': load('src/lib/familySquaresCard.ts', {}), '../lib/situation': { DEFAULT_SITUATION: {}, funnelDoor: () => '' }, '../content/curriculum': { phaseForWeek: () => '', isBeyondAuthoredCurriculum: () => false, curriculumWeek: () => 1 } };
  const module = load(which === 'today' ? 'src/hooks/useTodayFeed.ts' : 'src/hooks/useSessions.ts', imports, { console: { ...console, warn() {} } });
  const hook = which === 'today' ? module.useTodayFeed('account-A', null) : module.useSessions('account-A');
  // (useTodayFeed's states: nextFreeCall is the 9th, seatSavedHere the 11th; useSessions: sessions, loading, seatSavedHere.)
  return { alerts, session, states, reloads, savedHere: () => states[which === 'today' ? 10 : 2], run: which === 'today' ? hook.rsvpFreeCall : hook.toggleRsvp };
}

test('Today: a seat the website refused says what is true, never "check your connection"', async () => {
  const unknown = hooks('today', { ok: false, reason: 'website_declined' });
  await unknown.run(); await settle();
  assert.deepEqual(unknown.alerts, [['support:sessions.rsvpErrorTitle', 'common:familySquares.registrationUnavailable']]);
  assert.ok(unknown.reloads.length > 0, 'the card is read again: the week may just have been cancelled');
  for (const options of [{ cardCancelled: true }, { knownCancelled: true }]) {
    const h = hooks('today', { ok: false, reason: 'website_declined' }, options);
    await h.run(); await settle();
    assert.deepEqual(h.alerts, [['support:sessions.rsvpErrorTitle', 'common:familySquares.cancelled.line']]);
  }
  // A real connection problem keeps its own words, even in a week known cancelled.
  const offline = hooks('today', { ok: false }, { knownCancelled: true });
  await offline.run(); await settle();
  assert.deepEqual(offline.alerts, [['support:sessions.rsvpErrorTitle', 'support:sessions.rsvpErrorBody']]);
  assert.equal(offline.reloads.length, 0);
});

test('Support: a refused seat is reported as refused, and the list is read again', async () => {
  const h = hooks('support', { ok: false, reason: 'website_declined' });
  assert.equal(await h.run(h.session), 'website_declined'); await settle();
  assert.ok(h.reloads.length > 0);
  assert.equal(await hooks('support', { ok: false }).run({ id: 'x', title: 'The Family Squares', rsvped: false }), false);
  const support = source('app/(tabs)/support.tsx');
  assert.match(support, /else if \(saved === 'website_declined'\) \{\s+appAlert\(t\('sessions\.rsvpErrorTitle'\), t\(seatSaveFailureKey\('website_declined', session\.cancelled === true \|\| isFamilySquaresKnownCancelled\(\)\)\)\);/);
  // Onboarding's "Save my spot" says the same.
  assert.match(source('app/(onboarding)/notifications.tsx'), /t\(seatSaveFailureKey\(reserved\.reason, isFamilySquaresKnownCancelled\(\)\)\)/);
});

// ── L1: the reminder ask follows only her own Save tap ──────────────────────

for (const which of ['today', 'support']) test(`${which}: only a Save tap that saved a seat she did not have counts as "saved here"`, async () => {
  const saved = hooks(which, { ok: true, alreadyRegistered: false });
  assert.equal(saved.savedHere(), 0);
  await saved.run(saved.session); await settle();
  assert.equal(saved.savedHere(), 1);
  // Already going (a second tap re-registers): not a new seat.
  const again = hooks(which, { ok: true, alreadyRegistered: true }, { rsvped: true });
  await again.run(again.session); await settle();
  assert.equal(again.savedHere(), 0);
  // A save that failed, or was refused: nothing to be reminded of.
  for (const result of [{ ok: false }, { ok: false, reason: 'website_declined' }]) {
    const failed = hooks(which, result);
    await failed.run(failed.session); await settle();
    assert.equal(failed.savedHere(), 0);
  }
});

// ── L2: attendance is marked logged only once the server has it ─────────────

function attendance({ send }) {
  const device = deviceStore(), sent = [];
  const join = load('src/lib/familySquaresJoin.ts', { '../../supabase/functions/_shared/family-squares-time': timeAt(MeetingTime), './familySquaresSchedule': load('src/lib/familySquaresSchedule.ts') }, { Date: MeetingTime });
  const lib = load('src/lib/meetingAttendance.ts', {
    '@react-native-async-storage/async-storage': device.module,
    './funnel': { logFunnelEventConfirmed: (stage, meta) => { sent.push([stage, plain(meta)]); return send(); } },
    './monitoring': { captureAppError() {} },
    './authBootstrap': load('src/lib/authBootstrap.ts'),
    './familySquaresJoin': join,
    './familySquaresFirstTimer': { markFamilySquaresJoined: async () => {} },
  }, { Date: MeetingTime });
  return { lib, device, sent };
}
const JOIN_KEY = '@sh:family-squares-join:account-A', LOGGED_KEY = '@sh:family-squares-attended:account-A';
const TWENTY_MINUTES_LATER = Date.parse('2026-11-17T03:25:00Z');

test('a send that fails keeps the Join mark, and the next return logs the meeting once', async () => {
  let online = false;
  const h = attendance({ send: async () => online });
  await h.lib.markFamilySquaresJoin('account-A', 'today');          // 7:05 PM, the meeting is on
  assert.ok(h.device.store.has(JOIN_KEY));
  // Back in the app with no signal: nothing is marked as logged, the mark stays.
  assert.equal(await h.lib.flushFamilySquaresAttendance('account-A', TWENTY_MINUTES_LATER), false);
  assert.equal(h.sent.length, 1);
  assert.ok(h.device.store.has(JOIN_KEY), 'the mark is kept for the next return');
  assert.equal(h.device.store.has(LOGGED_KEY), false, 'not marked as logged');
  // The next return, with a connection.
  online = true;
  assert.equal(await h.lib.flushFamilySquaresAttendance('account-A', TWENTY_MINUTES_LATER + 60_000), true);
  assert.deepEqual(h.sent[1], ['attended_10min', { meeting_date: '2026-11-16', source: 'today' }]);
  assert.equal(h.device.store.get(LOGGED_KEY), '2026-11-16');
  assert.equal(h.device.store.has(JOIN_KEY), false);
  // And never again for that meeting.
  assert.equal(await h.lib.flushFamilySquaresAttendance('account-A', TWENTY_MINUTES_LATER + 120_000), false);
  assert.equal(h.sent.length, 2);
});

test('the retries stop at the mark\'s own expiry, and two returns at once send one event', async () => {
  const offline = attendance({ send: async () => false });
  await offline.lib.markFamilySquaresJoin('account-A', 'push');
  await offline.lib.flushFamilySquaresAttendance('account-A', TWENTY_MINUTES_LATER);
  const nextMorning = Date.parse('2026-11-17T16:00:00Z');
  assert.equal(await offline.lib.flushFamilySquaresAttendance('account-A', nextMorning), false);
  assert.equal(offline.sent.length, 1, 'a stale mark is not sent');
  assert.equal(offline.device.store.has(JOIN_KEY), false, 'and is removed');
  // Still too early to say: kept, nothing sent.
  const early = attendance({ send: async () => true });
  await early.lib.markFamilySquaresJoin('account-A', 'today');
  assert.equal(await early.lib.flushFamilySquaresAttendance('account-A', Date.parse('2026-11-17T03:08:00Z')), false);
  assert.equal(early.sent.length, 0); assert.ok(early.device.store.has(JOIN_KEY));
  // Foreground twice in a row while the first send is still out.
  const gate = deferred();
  const slow = attendance({ send: () => gate.promise });
  await slow.lib.markFamilySquaresJoin('account-A', 'support');
  const first = slow.lib.flushFamilySquaresAttendance('account-A', TWENTY_MINUTES_LATER), second = slow.lib.flushFamilySquaresAttendance('account-A', TWENTY_MINUTES_LATER);
  await settle(); gate.resolve(true);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(slow.sent.length, 1);
});

test('the confirmed funnel send answers whether the server took the event', async () => {
  const funnel = (rpc) => load('src/lib/funnel.ts', { './supabase': { supabase: { rpc } }, './membershipPath': { membershipPathMetadata: (input) => input } }, { console: { ...console, warn() {} } });
  assert.equal(await funnel(async () => ({ error: null })).logFunnelEventConfirmed('attended_10min', {}), true);
  assert.equal(await funnel(async () => ({ error: { message: 'denied' } })).logFunnelEventConfirmed('attended_10min', {}), false);
  assert.equal(await funnel(() => Promise.reject(Error('offline'))).logFunnelEventConfirmed('attended_10min', {}), false);
  assert.equal(await funnel(() => { throw Error('no client'); }).logFunnelEventConfirmed('attended_10min', {}), false);
});

// ── L5: which sessions the device knows ─────────────────────────────────────

const FAMILY_SQUARES = '123e4567-e89b-42d3-a456-426614174222', LA_SOBREMESA = '223e4567-e89b-42d3-a456-426614174333', GROUP = '323e4567-e89b-42d3-a456-426614174444';
test('the device remembers the other sessions it has seen, added to what it already had stored', async () => {
  const device = deviceStore();
  const cache = () => load('src/lib/familySquaresSessionCache.ts', { '@react-native-async-storage/async-storage': device.module, './familySquaresSchedule': load('src/lib/familySquaresSchedule.ts') });
  const first = cache();
  assert.deepEqual(plain(await first.knownOtherSessionIds()), []);
  first.rememberFamilySquaresSession([{ id: FAMILY_SQUARES, title: 'The Family Squares' }, { id: LA_SOBREMESA, title: 'La Sobremesa' }]);
  await settle();
  assert.deepEqual(plain(await first.knownOtherSessionIds()), [LA_SOBREMESA]);
  assert.equal(await first.knownFamilySquaresSessionId(), FAMILY_SQUARES);
  // A cold start: read back from the device, and a single looked-up row is added, not written over it.
  const second = cache();
  second.rememberFamilySquaresSession([{ id: GROUP.toUpperCase(), title: 'Boundaries Night' }]);
  await settle();
  assert.deepEqual(plain(await second.knownOtherSessionIds()).sort(), [LA_SOBREMESA, GROUP].sort());
  assert.deepEqual(JSON.parse(device.store.get('@sh:family-squares:other-session-ids')).sort(), [LA_SOBREMESA, GROUP].sort());
  // The row that is Family Squares is never also "something else", and junk is ignored.
  second.rememberFamilySquaresSession([{ id: LA_SOBREMESA, title: 'The Family Squares' }, { id: 'nope', title: 'x' }, { title: 'no id' }]);
  await settle();
  assert.deepEqual(plain(await second.knownOtherSessionIds()), [GROUP]);
  second.rememberFamilySquaresSession(null);
  // Unreadable storage: none known, never a throw.
  const broken = load('src/lib/familySquaresSessionCache.ts', { '@react-native-async-storage/async-storage': { default: { getItem: async () => { throw Error('locked'); }, setItem: async () => {} } }, './familySquaresSchedule': load('src/lib/familySquaresSchedule.ts') });
  assert.deepEqual(plain(await broken.knownOtherSessionIds()), []);
  for (const raw of ['{', '"x"', '[1, null, "nope"]']) {
    const odd = load('src/lib/familySquaresSessionCache.ts', { '@react-native-async-storage/async-storage': deviceStore({ '@sh:family-squares:other-session-ids': raw }).module, './familySquaresSchedule': load('src/lib/familySquaresSchedule.ts') });
    assert.deepEqual(plain(await odd.knownOtherSessionIds()), [], raw);
  }
  // Only session ids are kept: nothing about the member.
  assert.doesNotMatch(source('src/lib/familySquaresSessionCache.ts'), /accountId|email|user/i);
});

// ── L6: the device's copy of "her loved one died" ───────────────────────────

test('screens that sell follow the device\'s copy, and "not known" never shows a sales prompt', async () => {
  const device = deviceStore({ '@sh:bereaved:account-B': '1', '@sh:bereaved:account-C': '0', '@sh:bereaved:account-D': 'maybe' });
  const lib = load('src/lib/bereavedDevice.ts', { '@react-native-async-storage/async-storage': device.module, './bereavement': load('src/lib/bereavement.ts') });
  assert.equal(lib.knownBereavedOnDevice('account-A'), undefined);
  assert.equal(await lib.loadBereavedOnDevice('account-A'), undefined, 'a new phone: not known');
  assert.equal(await lib.loadBereavedOnDevice('account-B'), true);
  assert.equal(await lib.loadBereavedOnDevice('account-C'), false);
  assert.equal(await lib.loadBereavedOnDevice('account-D'), undefined);
  assert.equal(lib.salesAllowedForBereavement(false), true);
  assert.equal(lib.salesAllowedForBereavement(true), false);
  assert.equal(lib.salesAllowedForBereavement(undefined), false);
  // Today marks it: every screen hears at once, and the device keeps it.
  const heard = [];
  const unsubscribe = lib.subscribeBereavedOnDevice((account, bereaved) => heard.push([account, bereaved]));
  lib.rememberBereavedOnDevice('account-A', true);
  assert.deepEqual(heard, [['account-A', true]]);
  assert.equal(lib.knownBereavedOnDevice('account-A'), true);
  assert.equal(await lib.loadBereavedOnDevice('account-A'), true);
  await settle();
  assert.equal(device.store.get('@sh:bereaved:account-A'), '1');
  unsubscribe(); lib.rememberBereavedOnDevice('account-A', false);
  assert.equal(heard.length, 1); assert.equal(lib.knownBereavedOnDevice('account-A'), false);
  // Unreadable storage is "not known", never a throw.
  const broken = load('src/lib/bereavedDevice.ts', { '@react-native-async-storage/async-storage': { default: { getItem: async () => { throw Error('locked'); }, setItem: async () => {} } }, './bereavement': load('src/lib/bereavement.ts') });
  assert.equal(await broken.loadBereavedOnDevice('account-A'), undefined);
});
