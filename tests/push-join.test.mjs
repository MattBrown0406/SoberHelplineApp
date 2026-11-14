import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Runs the real reminder-tap and Join code with small doubles for the network,
// the device store and Zoom.
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

const FAMILY_SQUARES = '123e4567-e89b-42d3-a456-426614174222';
const LA_SOBREMESA = '223e4567-e89b-42d3-a456-426614174333';
const ZOOM = 'https://us02web.zoom.us/j/123456789';
// Monday 2026-11-16, 7:05 PM Pacific: the meeting is under way.
class MeetingTime extends Date { constructor(...args) { super(...(args.length ? args : ['2026-11-17T03:05:00Z'])); } static now() { return new Date().getTime(); } }

function pushJoin({ knownId = null, row = { title: 'The Family Squares', zoom_url: ZOOM }, lookupError = false } = {}) {
  const lookups = [], timeouts = [], remembered = [], events = [], opened = [], marks = [];
  const timeoutGates = [];
  const lookupGate = { current: null };
  let openFails = false;
  const time = load('supabase/functions/_shared/family-squares-time.ts', {}, { Date: MeetingTime });
  const schedule = load('src/lib/familySquaresSchedule.ts');
  const join = load('src/lib/familySquaresJoin.ts', { '../../supabase/functions/_shared/family-squares-time': time, './familySquaresSchedule': schedule }, { Date: MeetingTime });
  const lib = load('src/lib/familySquaresPushJoin.ts', {
    'react-native': { Linking: { openURL: async (url) => { events.push('open'); if (openFails) throw Error('no zoom'); opened.push(url); } } },
    './supabase': { supabase: { from: () => ({ select() { return this; }, eq(_, id) { lookups.push(id); return this; }, async maybeSingle() { if (lookupGate.current) await lookupGate.current.promise; return lookupError ? { data: null, error: { message: 'offline' } } : { data: row, error: null }; } }) } },
    './funnel': { logFunnelEventAndWait: async (stage, meta) => { events.push(`log:${stage}:${meta.source}`); } },
    './websiteLinks': { withAppContext: (url) => `${url}?app=1` },
    // The real cap, without the waiting: the test decides when "too slow" happens.
    './authBootstrap': { withTimeoutFallback: (operation, ms, fallback) => { timeouts.push(ms); const gate = deferred(); timeoutGates.push(gate); return Promise.race([operation, gate.promise.then(() => fallback)]); } },
    './familySquaresJoin': join,
    './familySquaresSessionCache': { knownFamilySquaresSessionId: async () => knownId, rememberFamilySquaresSession: (sessions) => { remembered.push(plain(sessions)); } },
    './meetingAttendance': { markFamilySquaresJoin: async (id, from) => { events.push('mark'); marks.push([id, from]); }, clearFamilySquaresJoin: async () => { events.push('clear'); } },
  });
  return { lib, lookups, timeouts, timeoutGates, remembered, events, opened, marks, lookupGate, failOpen() { openFails = true; } };
}

test('a reminder for any other session opens at once: no lookup, no waiting', async () => {
  const h = pushJoin({ knownId: FAMILY_SQUARES });
  assert.deepEqual(plain(await h.lib.planReminderJoin(LA_SOBREMESA)), { action: 'default' });
  assert.deepEqual(h.lookups, [], 'the network is never asked');
  assert.deepEqual(h.timeouts, [300], 'only the local read of the remembered id is capped');
});

test('a Family Squares reminder looks its link up, for a second and a half at most', async () => {
  const h = pushJoin({ knownId: FAMILY_SQUARES });
  assert.equal(h.lib.LOOKUP_TIMEOUT_MS, 1500);
  assert.deepEqual(plain(await h.lib.planReminderJoin(FAMILY_SQUARES)), { action: 'open_meeting', url: ZOOM, meetingDate: '2026-11-16' });
  assert.deepEqual(h.lookups, [FAMILY_SQUARES]);
  assert.deepEqual(h.timeouts, [300, 1500]);
});

test('a slow or failed Family Squares lookup lands on Today\'s call card', async () => {
  const slow = pushJoin({ knownId: FAMILY_SQUARES });
  slow.lookupGate.current = deferred();
  const pending = slow.lib.planReminderJoin(FAMILY_SQUARES);
  await settle(); slow.timeoutGates[1].resolve();         // 1.5 seconds have passed
  assert.deepEqual(plain(await pending), { action: 'call_card' });
  const failed = pushJoin({ knownId: FAMILY_SQUARES, lookupError: true });
  assert.deepEqual(plain(await failed.lib.planReminderJoin(FAMILY_SQUARES)), { action: 'call_card' });
});

test('a device that has not seen the session list yet still never waits more than the cap', async () => {
  // Known after one lookup: Family Squares is remembered for next time.
  const first = pushJoin();
  assert.deepEqual(plain(await first.lib.planReminderJoin(FAMILY_SQUARES)).action, 'open_meeting');
  assert.deepEqual(first.remembered, [[{ id: FAMILY_SQUARES, title: 'The Family Squares' }]]);
  // Another session: the usual destination, and nothing wrong is remembered by the cache's own rule.
  const other = pushJoin({ row: { title: 'La Sobremesa', zoom_url: null } });
  assert.deepEqual(plain(await other.lib.planReminderJoin(LA_SOBREMESA)), { action: 'default' });
  // Too slow, and we do not know what it is: what the push always opened.
  const slow = pushJoin();
  slow.lookupGate.current = deferred();
  const pending = slow.lib.planReminderJoin(LA_SOBREMESA);
  await settle(); slow.timeoutGates[1].resolve();
  assert.deepEqual(plain(await pending), { action: 'default' });
  assert.deepEqual(slow.timeouts, [300, 1500]);
});

test('joining from a push: the mark, then the funnel event, then Zoom', async () => {
  const h = pushJoin();
  assert.equal(await h.lib.joinFamilySquaresFromPush('account-A', ZOOM), true);
  assert.deepEqual(h.events, ['mark', 'log:attended:push', 'open']);
  assert.deepEqual(h.opened, [`${ZOOM}?app=1`]);
  const failing = pushJoin(); failing.failOpen();
  assert.equal(await failing.lib.joinFamilySquaresFromPush('account-A', ZOOM), false);
  assert.deepEqual(failing.events, ['mark', 'log:attended:push', 'open', 'clear']);
});

// ── The funnel event that is waited for ─────────────────────────────────────

function funnel(rpc) {
  const warnings = [];
  const lib = load('src/lib/funnel.ts', {
    './supabase': { supabase: { rpc } },
    './membershipPath': { membershipPathMetadata: (input) => input },
  }, { console: { ...console, warn: (...args) => warnings.push(args) } });
  return { lib, warnings };
}

test('the Join event is sent and waited for, but never for longer than its limit', async () => {
  const calls = [];
  const quick = funnel((name, args) => { calls.push([name, plain(args)]); return Promise.resolve({ error: null }); });
  assert.equal(quick.lib.FUNNEL_SEND_WAIT_MS, 800);
  await quick.lib.logFunnelEventAndWait('attended', { source: 'today' });
  assert.deepEqual(calls, [['log_funnel_event', { p_stage: 'attended', p_metadata: { source: 'today' } }]]);

  // A network that never answers: joining goes ahead after the limit (20 ms here).
  let sent = 0;
  const stuck = funnel(() => { sent += 1; return new Promise(() => {}); });
  const started = Date.now();
  await stuck.lib.logFunnelEventAndWait('attended', { source: 'push' }, 20);
  assert.equal(sent, 1, 'the request was still made before Zoom opens');
  assert.ok(Date.now() - started < 500);

  // A failure, a rejection or a throwing client never stops the Join.
  for (const rpc of [() => Promise.resolve({ error: { message: 'denied' } }), () => Promise.reject(Error('offline')), () => { throw Error('no client'); }]) {
    await funnel(rpc).lib.logFunnelEventAndWait('attended', { source: 'today' }, 20);
    funnel(rpc).lib.logFunnelEvent('attended', { source: 'support' });
  }
  await settle();
});

test('the device remembers which session is Family Squares, and nothing about the member', async () => {
  const store = new Map(), writes = [];
  const cache = () => load('src/lib/familySquaresSessionCache.ts', {
    '@react-native-async-storage/async-storage': { default: { getItem: async (key) => store.get(key) ?? null, setItem: async (key, value) => { writes.push([key, value]); store.set(key, value); } } },
    './familySquaresSchedule': load('src/lib/familySquaresSchedule.ts'),
  });
  const first = cache();
  assert.equal(await first.knownFamilySquaresSessionId(), null);
  first.rememberFamilySquaresSession([{ id: LA_SOBREMESA, title: 'La Sobremesa' }]);
  assert.equal(await first.knownFamilySquaresSessionId(), null, 'only the Family Squares row counts');
  first.rememberFamilySquaresSession([{ id: LA_SOBREMESA, title: 'La Sobremesa' }, { id: FAMILY_SQUARES, title: 'The Family Squares' }]);
  first.rememberFamilySquaresSession([{ id: FAMILY_SQUARES, title: 'The Family Squares' }]);
  first.rememberFamilySquaresSession(null);
  first.rememberFamilySquaresSession([{ id: 'not-an-id', title: 'The Family Squares' }]);
  assert.equal(await first.knownFamilySquaresSessionId(), FAMILY_SQUARES);
  assert.deepEqual(writes, [['@sh:family-squares:session-id', FAMILY_SQUARES]], 'written once, and only the session id');
  // After a restart it is read back from the device.
  assert.equal(await cache().knownFamilySquaresSessionId(), FAMILY_SQUARES);
  assert.doesNotMatch(source('src/lib/familySquaresSessionCache.ts'), /accountId|email|user/i);
});
