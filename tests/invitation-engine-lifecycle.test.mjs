import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Runs the real hook with deterministic hook scheduling and a movable UTC clock.
// This is not a rendered/native UI test.
function fixture() {
  const slots = []; let index = 0; let effects = []; let tick; let now = '2026-10-01T23:59:00Z'; let account = 'A';
  const equal = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const react = {
    useState(initial) { const i = index++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
    useCallback(fn, deps) { const i = index++; if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useMemo(fn, deps) { return react.useCallback(fn, deps)(); },
    useEffect(fn, deps) { const i = index++; if (!slots[i] || !equal(slots[i].deps, deps)) { const old = slots[i]; slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  const reads = [], writes = [], forecasts = []; let resolveCheck;
  const snapshot = date => ({ localDate: date, plan: { seed: 'family', signals: {} }, today: { movesDone: [], check: null, forecast: null }, inputs: { moveDaysLast7: 0 }, state: {} });
  const mocks = {
    react,
    'expo-router': { useFocusEffect: fn => react.useEffect(fn, [fn]) },
    '../lib/invitationEngine': { localClock: date => ({ date: date.toISOString().slice(0, 10), hour: date.getUTCHours(), weekday: date.getUTCDay() }), engineStage: () => 'active', engineForecastInput: s => s },
    '../lib/invitationForecast': { scoreReceptivity: () => ({ level: 'possible', score: 50 }) },
    '../lib/invitationMoves': { selectDailyMoves: () => [] },
    '../lib/monitoring': { captureAppError() {} },
    './useFeatureAccess': { useFeatureAccess: () => true },
    '../lib/invitationApi': {
      fetchEngineSnapshot: async date => { reads.push(date); return snapshot(date); },
      recordForecast: async date => { forecasts.push(date); },
      setMoveDone: async (...args) => { writes.push(args); return []; },
      setQuickCheck: (...args) => { writes.push(args); return new Promise(r => { resolveCheck = r; }); },
      setWindowPush: async enabled => enabled,
    },
  };
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
  const module = { exports: {} };
  const source = fs.readFileSync(new URL('../src/hooks/useInvitationEngine.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    module, exports: module.exports, require(id) { assert.ok(id in mocks, id); return mocks[id]; }, Date: Clock,
    setInterval(fn) { tick = fn; return 1; }, clearInterval() {},
  });
  const read = () => { index = 0; return module.exports.useInvitationEngine(account, 'UTC'); };
  const flush = async () => { for (let i = 0; i < 5; i++) { read(); const pending = effects; effects = []; pending.forEach(fn => fn()); await Promise.resolve(); } return read(); };
  return { read, flush, reads, writes, forecasts, advance(date) { now = date; tick(); }, switchAccount(id) { account = id; }, finishCheck(value) { resolveCheck(value); } };
}

test('midnight refreshes daily moves and never records a new forecast against yesterday', async () => {
  const f = fixture(); await f.flush();
  assert.equal(f.read().snapshot.localDate, '2026-10-01');
  const before = f.forecasts.length;
  f.advance('2026-10-02T00:01:00Z');
  assert.equal(f.read().snapshot, null, 'hide the expired daily snapshot before the new read');
  await f.flush();
  assert.equal(f.read().snapshot.localDate, '2026-10-02');
  assert.ok(f.reads.includes('2026-10-02'));
  assert.deepEqual(f.forecasts.slice(before), ['2026-10-02']);
});

test('an old daily callback cannot write after midnight or an account change', async () => {
  const f = fixture(); await f.flush(); const old = f.read();
  f.advance('2026-10-02T00:01:00Z');
  assert.equal(await old.toggleMove('listen'), false);
  await f.flush(); const priorAccount = f.read();
  f.switchAccount('B'); f.read();
  assert.equal(await priorAccount.toggleMove('listen'), false);
  assert.equal(f.writes.length, 0);
});

test('a yesterday check response cannot overwrite the next day snapshot', async () => {
  const f = fixture(); await f.flush();
  const saving = f.read().setCheck('calm');
  f.advance('2026-10-02T00:01:00Z'); await f.flush();
  f.finishCheck('calm'); await saving;
  assert.equal(f.read().snapshot.today.check, null);
  assert.equal(f.read().checkSaving, false);
});
