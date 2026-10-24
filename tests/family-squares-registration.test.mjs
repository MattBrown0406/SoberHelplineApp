import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
function source(path) {
  if (process.env.AUDIT_BASELINE_REF && (path.startsWith('src/hooks/') || path === 'app/(onboarding)/notifications.tsx')) {
    return execFileSync('git', ['show', `${process.env.AUDIT_BASELINE_REF}:${path}`], { cwd: fileURLToPath(root), encoding: 'utf8' });
  }
  return fs.readFileSync(new URL(path, root), 'utf8');
}
function load(path, imports = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: (id) => {
    if (id in imports) return imports[id];
    throw Error(`Unexpected import ${id}`);
  }, Date, Intl, Response, Request, AbortSignal, console, ...globals });
  return module.exports;
}
const time = load('supabase/functions/_shared/family-squares-time.ts');
const schedule = load('src/lib/familySquaresSchedule.ts');
const fixed = '2026-10-12T19:00:00Z';
class Clock extends Date { constructor(...args) { super(...(args.length ? args : [fixed])); } static now() { return new Date(fixed).getTime(); } }
const success = { ok: true, already_registered: true, meeting_date: '2026-10-12' };

function edge(options = {}) {
  const writes = [], calls = [], filters = [];
  let handler;
  const admin = {
    auth: { getUser: async (jwt) => { assert.equal(jwt, 'verified-token'); return { data: { user: options.user === undefined ? { id: 'auth-A', email: ' A@example.test ', email_confirmed_at: fixed } : options.user }, error: options.authError }; } },
    from(table) {
      if (table === 'accounts') return { select() { return this; }, eq(k, v) { filters.push([k, v]); return this; }, maybeSingle: async () => ({ data: options.noAccount ? null : { id: 'account-A', first_name: 'Test', last_name: 'Family' }, error: options.accountError }) };
      assert.equal(table, 'session_rsvps');
      return { upsert: async (row, opts) => { writes.push(row); assert.equal(opts.onConflict, 'session_id,account_id'); return { error: options.saveError }; } };
    },
    rpc: async (name) => { assert.equal(name, 'family_squares_session_id'); return { data: 'english-session', error: options.sessionError }; },
  };
  load('supabase/functions/family-squares-register/index.ts', {
    'npm:@supabase/supabase-js@2': { createClient: () => admin },
    '../_shared/family-squares-time.ts': time,
    '../_shared/website-bridge.ts': { websiteFunctionUrl: () => 'https://website.invalid/app-family-squares-sync' },
  }, { Date: Clock, Deno: { serve: (fn) => { handler = fn; }, env: { get: () => 'server-secret' } }, fetch: async (url, init) => {
    calls.push(JSON.parse(init.body));
    assert.equal(init.headers['x-membership-sync-secret'], 'server-secret');
    if (options.networkError) throw Error('offline');
    return new Response(options.malformed ? 'not json' : JSON.stringify(options.response ?? success), { status: options.status ?? 200 });
  } });
  return { writes, calls, filters, run: (body = {}, authorization = 'Bearer verified-token') => handler(new Request('https://app.invalid', { method: 'POST', headers: { Authorization: authorization }, body: JSON.stringify(body) })) };
}

test('Edge reconciles verified identity only, persists accepted exact week and returns no PII', async () => {
  const e = edge(); const r = await e.run(); assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), success);
  assert.deepEqual(e.calls, [{ action: 'ensure-registration', meeting_date: '2026-10-12', attendee: { email: 'a@example.test', name: 'Test Family' } }]);
  assert.deepEqual(e.filters, [['user_id', 'auth-A']]);
  assert.equal(e.writes[0].account_id, 'account-A');
  assert.equal(e.writes[0].family_squares_meeting_date, '2026-10-12');
});
for (const [name, opts, body, auth] of [
  ['missing auth', {}, {}, ''], ['unverified', { user: { id: 'a', email: 'a@test' } }],
  ['anonymous', { user: { id: 'a', email: 'a@test', email_confirmed_at: fixed, is_anonymous: true } }],
  ['auth error', { authError: true }], ['account error', { accountError: true }],
  ['missing account', { noAccount: true }], ['session error', { sessionError: true }],
  ['client identity', {}, { email: 'victim@test', meeting_date: '2030-01-01' }],
  ['cancelled week', { status: 409, response: { ok: false, error: 'meeting_cancelled' } }],
  ['blocked attendee', { status: 403, response: { ok: false, error: 'registration_unavailable' } }],
]) test(`Edge fails closed: ${name}`, async () => { const e = edge(opts); assert.notEqual((await e.run(body, auth)).status, 200); assert.equal(e.writes.length, 0); });
// Without a usable website answer the RSVP snapshot alone is saved; the batch
// bridge registers it on the website, and nothing claims "already registered".
for (const [name, opts] of [
  ['website without ensure action', { status: 400, response: { ok: false, error: 'attendees_required' } }],
  ['absent endpoint', { status: 404 }], ['malformed', { malformed: true }],
  ['website failure', { status: 500, response: { ok: false, error: 'registration_failed' } }],
  ['wrong week', { response: { ...success, meeting_date: '2026-10-05' } }],
  ['false acceptance', { response: { ...success, ok: false } }],
  ['missing repeat flag', { response: { ok: true, meeting_date: '2026-10-12' } }],
  ['repeat flag on error status', { status: 500, response: success }],
  ['network error', { networkError: true }],
]) test(`Edge falls back to the RSVP snapshot: ${name}`, async () => {
  const e = edge(opts); const r = await e.run(); assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, already_registered: false, meeting_date: '2026-10-12' });
  assert.equal(e.writes.length, 1); assert.equal(e.writes[0].status, 'going');
  assert.equal(e.writes[0].family_squares_meeting_date, '2026-10-12');
});
test('native save failure remains retryable after website acceptance', async () => { const e = edge({ saveError: true }); assert.equal((await e.run()).status, 503); });

function client(options = {}) {
  const invokes = []; let sessions = 0;
  const api = { auth: { getSession: async () => ({ data: { session: { user: { id: ++sessions > 1 && options.switched ? 'auth-B' : 'auth-A' }, access_token: 'token-A' } } }) }, from() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { id: options.wrongAccount ? 'account-B' : 'account-A' } }) }; }, functions: { invoke: async (name, args) => { invokes.push({ name, args }); return options.failure ? { error: true } : { data: options.response ?? success }; } } };
  return { invokes, lib: load('src/lib/familySquaresRegistration.ts', { './supabase': { supabase: api }, '../../supabase/functions/_shared/family-squares-time': time }, { Date: Clock }) };
}
test('client coalesces taps, pins bearer, sends no identity and accepts authoritative repeat', async () => {
  const c = client(); const [a, b] = await Promise.all([c.lib.reserveFamilySquares('account-A'), c.lib.reserveFamilySquares('account-A')]);
  assert.equal(a.ok, true); assert.equal(a.alreadyRegistered, true); assert.equal(b.ok, true);
  assert.equal(c.invokes.length, 1); assert.deepEqual(JSON.parse(JSON.stringify(c.invokes[0].args)), { body: {}, headers: { Authorization: 'Bearer token-A' } });
});
for (const option of ['switched', 'wrongAccount', 'failure']) test(`client rejects ${option}`, async () => { const c = client({ [option]: true }); assert.equal((await c.lib.reserveFamilySquares('account-A')).ok, false); if (option === 'wrongAccount') assert.equal(c.invokes.length, 0); });
test('snapshot expires at Monday end, not Tuesday reset; DST uses Pacific Monday', () => {
  const { lib } = client();
  assert.equal(lib.familySquaresRsvpIsCurrent(null, new Date(fixed)), false);
  assert.equal(lib.familySquaresRsvpIsCurrent('2026-10-05', new Date(fixed)), false);
  assert.equal(lib.familySquaresRsvpIsCurrent('2026-10-12', new Date('2026-10-13T02:59:59Z')), true);
  assert.equal(lib.familySquaresRsvpIsCurrent('2026-10-12', new Date('2026-10-13T03:00:00Z')), false);
  assert.equal(lib.familySquaresRsvpIsCurrent('2026-10-19', new Date('2026-10-13T09:00:00Z')), true);
  assert.equal(lib.familySquaresRsvpIsCurrent('2026-11-02', new Date('2026-11-03T03:59:59Z')), true);
});

function hooks(which, result = { ok: true, alreadyRegistered: true }, options = {}) {
  const alerts = [], writes = [], reservations = [], states = [], counts = [], reads = [], warnings = [];
  const session = { id: 'english-session', title: 'The Family Squares', rsvped: options.rsvped ?? true, zoom_url: 'https://zoom.invalid', next_at: null };
  let slot = 0;
  const react = { useState: (initial) => { const index = slot++; states[index] = which === 'today' && index === 8 ? session : which === 'today' && index === 2 ? options.initialCount ?? 0 : initial; return [states[index], (next) => { states[index] = typeof next === 'function' ? next(states[index]) : next; if (index === 2) counts.push(states[index]); }]; }, useCallback: (fn) => fn, useEffect() {}, useRef: (value) => ({ current: value }) };
  const query = { select(columns, config) { reads.push([columns, config]); return this; }, delete() { writes.push('delete'); return this; }, upsert() { writes.push('upsert'); return this; }, eq(key, value) { if (reads.length) reads.push([key, value]); return this; }, then(resolve, reject) { if (options.countReject) return Promise.reject(Error('offline')).then(resolve, reject); return Promise.resolve(options.countResponse ?? { count: 1, error: null }).then(resolve, reject); } };
  const imports = { react, 'expo-router': { useFocusEffect() {} }, 'react-i18next': { useTranslation: () => ({ i18n: { language: 'en' } }) }, i18next: { default: { t: (v) => v } }, '../lib/supabase': { supabase: { from: () => query } }, '../lib/familySquaresSchedule': schedule, '../lib/laSobremesa': { reserveLaSobremesa: async () => { throw Error('unexpected Spanish registration'); } }, '../lib/appAlert': { appAlert: (...args) => alerts.push(args) }, '../lib/familySquaresRegistration': { reserveFamilySquares: async (id) => { reservations.push(id); return result; }, familySquaresRsvpIsCurrent: () => false, FAMILY_SQUARES_ALREADY_REGISTERED: 'common:familySquares.alreadyRegistered' }, '../lib/situation': { DEFAULT_SITUATION: {}, funnelDoor: () => '' }, '../content/curriculum': { phaseForWeek: () => '', isBeyondAuthoredCurriculum: () => false } };
  const module = load(which === 'today' ? 'src/hooks/useTodayFeed.ts' : 'src/hooks/useSessions.ts', imports, { console: { ...console, warn: (...args) => warnings.push(args) } });
  const hook = which === 'today' ? module.useTodayFeed('account-A', null) : module.useSessions('account-A');
  return { alerts, writes, reservations, session, states, counts, reads, warnings, run: which === 'today' ? hook.rsvpFreeCall : hook.toggleRsvp };
}
for (const [name, initialCount, alreadyRegistered] of [
  ['legacy going row', 1, true],
  ['stale going row renewed for this week', 1, false],
  ['new going row', 0, false],
]) test(`Today actual RSVP callback recounts ${name} without an optimistic overcount`, async () => {
  const h = hooks('today', { ok: true, alreadyRegistered }, { rsvped: false, initialCount });
  await h.run();
  assert.equal(h.states[2], 1);
  assert.deepEqual(h.counts, [1]);
  assert.equal(h.states[8].rsvped, true);
  assert.deepEqual(JSON.parse(JSON.stringify(h.reads)), [['*', { count: 'exact', head: true }], ['status', 'going']]);
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.reservations, ['account-A']);
  assert.equal(h.warnings.length, 0);
});
for (const [name, options] of [
  ['returned error', { countResponse: { count: 99, error: { message: 'unavailable' } } }],
  ['rejected query', { countReject: true }],
  ['missing count', { countResponse: { count: null, error: null } }],
]) test(`Today recount ${name} preserves last known count and successful registration`, async () => {
  const h = hooks('today', { ok: true, alreadyRegistered: true }, { rsvped: false, initialCount: 1, ...options });
  await h.run();
  assert.equal(h.states[2], 1);
  assert.deepEqual(h.counts, []);
  assert.equal(h.states[8].rsvped, true);
  assert.equal(h.warnings.length, 1);
  assert.equal(h.alerts[0][0], 'common:familySquares.alreadyRegistered');
  assert.deepEqual(h.writes, []);
});
test('Today failed ensure does not recount or change count', async () => {
  const h = hooks('today', { ok: false }, { rsvped: false, initialCount: 1 });
  await h.run();
  assert.equal(h.states[2], 1);
  assert.equal(h.states[8].rsvped, false);
  assert.deepEqual(h.reads, []);
  assert.deepEqual(h.counts, []);
});
for (const which of ['today', 'support']) {
  test(`${which}: going repeat reconciles without deletion and gives exact friendly message`, async () => { const h = hooks(which); await h.run(h.session); assert.equal(h.writes.length, 0); assert.equal(h.reservations.length, 1); assert.equal(h.alerts[0][0], 'common:familySquares.alreadyRegistered'); });
  test(`${which}: stale going new-week creation never claims already registered`, async () => { const h = hooks(which, { ok: true, alreadyRegistered: false }); await h.run(h.session); assert.equal(h.reservations.length, 1); assert.equal(h.alerts.length, 0); assert.equal(h.writes.length, 0); });
  test(`${which}: unavailable never writes or claims registration`, async () => { const h = hooks(which, { ok: false }); const saved = await h.run(h.session); assert.equal(h.writes.length, 0); if (which === 'support') assert.equal(saved, false); else assert.notEqual(h.alerts[0][0], 'common:familySquares.alreadyRegistered'); });
}
for (const title of ['Other Group', 'La Sobremesa']) test(`${title} cancellation remains unchanged`, async () => { const h = hooks('support'); await h.run({ ...h.session, title }); assert.deepEqual(h.writes, ['delete']); assert.equal(h.reservations.length, 0); });

test('onboarding actual repeat handler reconciles even when already marked going', async () => {
  const file = ts.createSourceFile('onboarding.tsx', source('app/(onboarding)/notifications.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let node; function visit(n) { if (ts.isFunctionDeclaration(n) && n.name?.text === 'reserveSpot') node = n; ts.forEachChild(n, visit); } visit(file);
  const code = ts.transpileModule(node.getText(file), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const alerts = [], writes = [];
  const context = { user: { id: 'account-A' }, nextGroupId: 'english', rsvped: true, spanish: false, reservationLock: { current: false }, identity: { current: 'account-A' }, setReserving() {}, setRsvped: (x) => writes.push(x), reserveFamilySquares: async () => ({ ok: true, alreadyRegistered: true }), appAlert: (x) => alerts.push(x), FAMILY_SQUARES_ALREADY_REGISTERED: 'friendly', t: (x) => x };
  vm.createContext(context); vm.runInContext(code, context); await context.reserveSpot();
  assert.deepEqual(writes, [true]); assert.deepEqual(alerts, ['friendly']);
});

test('repeat-registration copy is translated, not hardcoded', () => {
  for (const lang of ['en', 'es']) {
    const common = JSON.parse(fs.readFileSync(new URL(`src/locales/${lang}/common.json`, root), 'utf8'));
    assert.equal(typeof common.familySquares.alreadyRegistered, 'string');
  }
  assert.equal(JSON.parse(fs.readFileSync(new URL('src/locales/en/common.json', root), 'utf8')).familySquares.alreadyRegistered, 'You’re already registered. We look forward to seeing you Monday evening!');
  assert.doesNotMatch(source('src/lib/familySquaresRegistration.ts'), /already registered\./);
});
