import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// A slow read must never undo a newer answer. Runs the real hooks with small
// React / Supabase doubles (state kept between renders; effects run on render).
const root = new URL('../', import.meta.url);
const source = (path) => fs.readFileSync(new URL(path, root), 'utf8');
function load(path, imports = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: (id) => {
    if (id in imports) return imports[id];
    throw Error(`Unexpected import ${id}`);
  }, Date, Intl, console, Promise });
  return module.exports;
}
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
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

// ── "Save my seat every Monday" ─────────────────────────────────────────────

function weeklySeat() {
  const r = reactDouble();
  const loads = [], saves = [], focus = { run: null };
  let account = 'account-A';
  const hook = load('src/hooks/useFamilySquaresWeeklySeat.ts', {
    react: r.react,
    'expo-router': { useFocusEffect(callback) { focus.run = callback; } },
    '../lib/familySquaresSeat': {
      loadWeeklySeat: () => { const d = deferred(); loads.push(d); return d.promise; },
      saveWeeklySeat: () => { const d = deferred(); saves.push(d); return d.promise; },
      subscribeWeeklySeat: () => () => {},
    },
  }).useFamilySquaresWeeklySeat;
  const render = () => r.render(() => hook(account));
  return { loads, saves, render, focus() { focus.run(); }, switchAccount(next) { account = next; return render(); } };
}

test('weekly seat: a read that began before her change cannot put the old value back', async () => {
  const seat = weeklySeat();
  let api = seat.render();                       // the first read starts (and is slow)
  const saving = api.setEnabled(true);           // she turns the switch on
  await settle(); seat.saves[0].resolve(true); assert.equal(await saving, true);
  seat.loads[0].resolve(false);                  // the old read lands afterwards with "off"
  await settle(); api = seat.render();
  assert.equal(api.enabled, true, 'her change stays');
  assert.equal(api.busy, false);
});

test('weekly seat: of two reads, only the newest counts; a failed save puts the switch back', async () => {
  const seat = weeklySeat();
  let api = seat.render();                       // read 1 starts
  seat.focus();                                  // read 2 starts (the screen came into focus)
  seat.loads[1].resolve(true); await settle();   // the newer read answers first
  seat.loads[0].resolve(false); await settle();  // the older one lands last and is dropped
  api = seat.render();
  assert.equal(api.enabled, true);
  const saving = api.setEnabled(false); await settle(); api = seat.render();
  assert.equal(api.enabled, false); assert.equal(api.busy, true);
  seat.saves[0].resolve(false); assert.equal(await saving, false); api = seat.render();
  assert.equal(api.enabled, true, 'not saved: back where it was'); assert.equal(api.busy, false);
});

test('weekly seat: "saving" never stays stuck on when the account changes mid-save', async () => {
  const seat = weeklySeat();
  let api = seat.render();
  seat.loads[0].resolve(false); await settle();
  const saving = api.setEnabled(true); await settle(); api = seat.render();
  assert.equal(api.busy, true);
  api = seat.switchAccount('account-B');
  seat.saves[0].resolve(true); await saving; await settle(); api = seat.render();
  assert.equal(api.busy, false, 'the switch is usable again for the new account');
  assert.equal(api.enabled, false, "and it does not show the other account's answer");
});

// ── Support's sessions list ─────────────────────────────────────────────────

function sessionsHook() {
  const r = reactDouble();
  const rsvpReads = [], writes = [], focus = { run: null };
  let decline = async () => true;
  const sessionRows = [
    { id: 'fs', kind: 'group', title: 'The Family Squares', schedule_label: '', next_at: null, zoom_url: 'https://zoom.invalid/j/1' },
    { id: 'other', kind: 'group', title: 'Other Group', schedule_label: '', next_at: null, zoom_url: null },
  ];
  const from = () => {
    const chain = {
      write: null,
      select() { return chain; },
      order() { return Promise.resolve({ data: sessionRows }); },
      in() { return chain; },
      // The RSVP read ends in .eq(); a delete is awaited after its own .eq() calls.
      eq() { if (chain.write) return chain; const d = deferred(); rsvpReads.push(d); return d.promise; },
      delete() { chain.write = deferred(); writes.push(chain.write); return chain; },
      upsert() { const d = deferred(); writes.push(d); return d.promise; },
      then(resolve, reject) { return chain.write.promise.then(resolve, reject); },
    };
    return chain;
  };
  const hook = load('src/hooks/useSessions.ts', {
    react: r.react,
    i18next: { default: { t: (key) => key } },
    'react-i18next': { useTranslation: () => ({ i18n: { language: 'en' } }) },
    'expo-router': { useFocusEffect(callback) { focus.run = callback; } },
    '../lib/appAlert': { appAlert() {} },
    '../lib/supabase': { supabase: { from } },
    '../lib/familySquaresRegistration': { reserveFamilySquares: async () => ({ ok: true, alreadyRegistered: false }), familySquaresRsvpIsCurrent: (date) => date === 'this-week', FAMILY_SQUARES_ALREADY_REGISTERED: 'already' },
    '../lib/familySquaresSeat': { declineFamilySquares: (...args) => decline(...args) },
    '../lib/familySquaresSchedule': load('src/lib/familySquaresSchedule.ts'),
    '../lib/laSobremesa': { reserveLaSobremesa: async () => ({ ok: false }), withPersonalLinks: async (rows) => rows },
    '../lib/freshAnswer': load('src/lib/freshAnswer.ts'),
    '../lib/familySquaresSessionCache': { rememberFamilySquaresSession() {} },
  }).useSessions;
  const render = () => r.render(() => hook('account-A'));
  return {
    render, rsvpReads, writes,
    find: (id) => render().sessions.find((s) => s.id === id),
    /** Starts one more read (as coming back to the screen does) and returns its gate. */
    startRead() { const before = rsvpReads.length; render(); focus.run(); assert.equal(rsvpReads.length, before + 1); return rsvpReads[before]; },
    setDecline(fn) { decline = fn; },
  };
}
const going = [{ session_id: 'fs', status: 'going', family_squares_meeting_date: 'this-week' }];
/** A hook whose first read has landed with these RSVP rows. */
async function loadedSessions(rows) {
  const h = sessionsHook();
  h.render();
  h.rsvpReads[0].resolve({ data: rows }); await settle();
  return h;
}

test('Support: an old read landing after "Save my seat" does not show the seat as not saved', async () => {
  const h = await loadedSessions([]);
  assert.equal(h.find('fs').rsvped, false);
  const stale = h.startRead();                      // begins before her tap
  assert.equal(await h.render().toggleRsvp(h.find('fs')), true);
  assert.equal(h.find('fs').rsvped, true);
  stale.resolve({ data: [] }); await settle();     // lands with the answer from before it
  assert.equal(h.find('fs').rsvped, true, 'her seat stays saved');
});

test('Support: an old read landing after "can\'t make it" does not bring the seat back; a newer read is trusted again', async () => {
  const h = await loadedSessions(going);
  assert.equal(h.find('fs').rsvped, true);
  const stale = h.startRead();
  assert.equal(await h.render().declineRsvp(h.find('fs')), true);
  stale.resolve({ data: going }); await settle();
  assert.equal(h.find('fs').declined, true, 'her answer stays');
  assert.equal(h.find('fs').rsvped, false);
  assert.equal(h.find('fs').zoom_url, 'https://zoom.invalid/j/1', 'everything else still comes from the read');
  const fresh = h.startRead();                      // begins after her answer
  fresh.resolve({ data: going }); await settle();
  assert.equal(h.find('fs').rsvped, true, 'a read newer than her answer is applied as before');
});

test('Support: a read that began while "can\'t make it" was being saved is out of date too', async () => {
  const h = await loadedSessions(going);
  const gate = deferred(); h.setDecline(() => gate.promise);
  const declining = h.render().declineRsvp(h.find('fs'));
  const during = h.startRead();
  gate.resolve(true); assert.equal(await declining, true);
  during.resolve({ data: going }); await settle();
  assert.equal(h.find('fs').declined, true);
  assert.equal(h.find('fs').rsvped, false);
});

test('Support: a read landing while a plain RSVP is still being saved does not undo the tap', async () => {
  const h = await loadedSessions([]);
  const saving = h.render().toggleRsvp(h.find('other'));   // "going" at once, write on its way
  await settle();
  assert.equal(h.find('other').rsvped, true);
  const during = h.startRead();
  during.resolve({ data: [] }); await settle();            // lands before the save has finished
  assert.equal(h.find('other').rsvped, true, 'still going while the save is on its way');
  h.writes[0].resolve({ error: null }); assert.equal(await saving, true); await settle();
  assert.equal(h.find('other').rsvped, true);
  // And a failed save still goes back, as before.
  const cancel = h.render().toggleRsvp(h.find('other')); await settle();
  assert.equal(h.find('other').rsvped, false);
  h.writes[1].resolve({ error: { message: 'offline' } }); assert.equal(await cancel, false); await settle();
  assert.equal(h.find('other').rsvped, true);
});

// ── Today's call card ───────────────────────────────────────────────────────

test('withFreshAnswer keeps her answer over a read that began before it, and nothing else', () => {
  const { withFreshAnswer } = load('src/lib/freshAnswer.ts');
  const loaded = { id: 'fs', title: 'new title', rsvped: false, declined: false, zoom_url: 'https://zoom.invalid/new' };
  const onScreen = { id: 'fs', title: 'old title', rsvped: true, declined: false, zoom_url: 'https://zoom.invalid/old' };
  const plain = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(withFreshAnswer(loaded, onScreen, false)), loaded, 'nothing answered since: the read is applied whole');
  assert.deepEqual(plain(withFreshAnswer(loaded, onScreen, true)), { ...loaded, rsvped: true, declined: false });
  assert.deepEqual(plain(withFreshAnswer(loaded, null, true)), loaded, 'first load');
  assert.deepEqual(plain(withFreshAnswer(loaded, { ...onScreen, id: 'another' }, true)), loaded, 'a different meeting');
  // La Sobremesa: the personal link she was just given survives a read that has none yet.
  assert.equal(withFreshAnswer({ ...loaded, zoom_url: null }, onScreen, true).zoom_url, 'https://zoom.invalid/old');
  assert.deepEqual(plain(withFreshAnswer(loaded, { ...onScreen, rsvped: false, declined: true }, true)), { ...loaded, rsvped: false, declined: true });
});

test('Today\'s feed guards its call card (and the going count) the same way', () => {
  const feed = source('src/hooks/useTodayFeed.ts');
  assert.match(feed, /const request = \+\+generation\.current;\s+const answersAtStart = answers\.current;/);
  assert.match(feed, /const answeredSince = answersAtStart !== answers\.current \|\| reserving\.current;\s+setNextFreeCall\(\(prev\) => \(loadedCall \? withFreshAnswer\(loadedCall, prev, answeredSince\) : null\)\);/);
  assert.match(feed, /if \(answersAtStart === answers\.current && !reserving\.current\) setGroupSessions\(rsvpCountRes\.count \?\? 0\);/);
  // Every answer moves the counter: seat saved, La Sobremesa reserved, plain RSVP (start and end), "can't make it".
  assert.equal((feed.match(/\+\+answers\.current;/g) ?? []).length, 5);
  assert.equal((source('src/hooks/useSessions.ts').match(/\+\+answers\.current;/g) ?? []).length, 5);
});
