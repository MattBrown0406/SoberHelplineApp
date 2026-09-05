import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const slots = []; let cursor = 0; let current; let account = 'a'; const effects = []; const cleaned = []; const pruned = [];
  let deleteError = null; let loadError = null; let insertError = null; let pendingLoad = null;
  const row = { id: 'w', account_id: 'a', text: 'existing wall', anchor: null, anchor_tag: null, created_at: '2026-09-05', shared_with_coach_at: null };
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn) { return fn; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((v, j) => v !== slots[i].deps[j])) { slots[i]?.cleanup?.(); slots[i] = { deps }; effects.push(() => { slots[i].cleanup = fn(); }); } },
  };
  const supabase = { from(table) { assert.equal(table, 'walls'); let action = 'load';
    const q = { select() { return q; }, eq() { return q; }, order() { return pendingLoad ?? Promise.resolve({ data: [row], error: loadError }); },
      insert() { action = 'insert'; return q; }, single() { return Promise.resolve({ data: { ...row, id: 'new' }, error: insertError }); },
      delete() { action = 'delete'; return q; }, then(resolve, reject) { assert.equal(action, 'delete'); return Promise.resolve({ error: deleteError }).then(resolve, reject); },
    }; return q;
  } };
  const require = id => {
    if (id === 'react') return react;
    if (id.endsWith('/supabase')) return { supabase };
    if (id.endsWith('/boundaries')) return { getWalls: async () => [], saveWall: async () => {}, deleteWall: async () => {} };
    if (id.endsWith('/boundaryFollowThrough')) return { boundaryFollowThroughStore: { prune: async (...args) => { pruned.push(args); }, remove: async (...args) => { cleaned.push(args); } } };
    throw Error(id);
  };
  const source = readFileSync(new URL('../src/hooks/useBoundaries.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {}; new Function('require', 'exports', output)(require, exports);
  const api = { render() { cursor = 0; current = exports.useBoundaries(account); while(effects.length) effects.shift()(); return current; },
    get current() { return current; }, cleaned, pruned,
    deleteFails() { deleteError = Error('offline'); }, insertFails() { insertError = Error('offline'); },
    loadFails() { loadError = Error('offline'); }, deferLoad(p) { pendingLoad = p; }, account(value) { account = value; return api.render(); },
  }; return api;
}
test('failed wall delete keeps the wall and private companion; successful delete clears both', async () => {
  const ui = fixture(); ui.render(); await tick(); ui.render();
  assert.deepEqual(ui.pruned, [['a', ['w']]]);
  await ui.current.removeWall('w'); ui.render(); assert.equal(ui.current.walls.length, 0); assert.deepEqual(ui.cleaned, [['a', 'w']]);
  const failed = fixture(); failed.render(); await tick(); failed.render(); failed.deleteFails();
  await assert.rejects(failed.current.removeWall('w')); failed.render(); assert.equal(failed.current.walls.length, 1); assert.deepEqual(failed.cleaned, []);
});
test('failed loads never prune private companion data; failed inserts reject instead of claiming save', async () => {
  const ui = fixture(); ui.loadFails(); ui.render(); await tick(); ui.render(); assert.equal(ui.current.error, true); assert.deepEqual(ui.pruned, []);
  const insert = fixture(); insert.render(); await tick(); insert.render(); insert.insertFails(); await assert.rejects(insert.current.addWall('draft', null)); insert.render(); assert.equal(insert.current.walls.length, 1);
});
test('account change immediately hides old walls and fences delayed hydration and stale callbacks', async () => {
  const ui = fixture(); ui.render(); await tick(); ui.render(); const staleRemove = ui.current.removeWall;
  ui.account('b'); assert.equal(ui.current.walls.length, 0); await assert.rejects(staleRemove('w')); assert.deepEqual(ui.cleaned, []);
  const slow = fixture(); let resolve; slow.deferLoad(new Promise(r => { resolve = r; })); slow.render(); slow.account(null);
  resolve({ data: [{ id: 'old', account_id: 'a', text: 'private' }], error: null }); await tick(); slow.render(); assert.deepEqual(slow.current.walls, []); assert.deepEqual(slow.pruned, []);
});
