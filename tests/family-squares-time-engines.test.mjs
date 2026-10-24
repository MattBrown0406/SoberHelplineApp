// The phone (Hermes) runs this time code too. An engine that ignores hourCycle
// (12-hour output) or says "24" at midnight must give the same windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const src = fs.readFileSync(new URL('../supabase/functions/_shared/family-squares-time.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function load(mode) {
  const Real = Intl.DateTimeFormat;
  function Fake(locale, opts = {}) {
    const o = { ...opts }; delete o.hourCycle;
    if (mode === '12h' && o.hour) o.hour12 = true;
    const f = new Real(locale, o);
    return { formatToParts: (d) => f.formatToParts(d).map((p) => mode === '24' && p.type === 'hour' && p.value === '00' ? { ...p, value: '24' } : p) };
  }
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Date, Number, Math, Intl: { ...Intl, DateTimeFormat: Fake } });
  return module.exports;
}
const real = (() => { const m = { exports: {} }; vm.runInNewContext(code, { module: m, exports: m.exports, Date, Number, Math, Intl }); return m.exports; })();
for (const mode of ['12h', '24']) test(`engine ${mode} gives the same windows`, () => {
  const fake = load(mode);
  for (let t = Date.UTC(2026, 9, 1); t < Date.UTC(2026, 11, 31); t += 37 * 60_000) {
    const d = new Date(t);
    assert.equal(fake.familySquaresSyncWindow(d).meetingDate, real.familySquaresSyncWindow(d).meetingDate, d.toISOString());
    assert.equal(fake.familySquaresSyncWindow(d).start.getTime(), real.familySquaresSyncWindow(d).start.getTime());
    assert.equal(JSON.stringify(fake.pacificWeekdayHour(d)), JSON.stringify(real.pacificWeekdayHour(d)), d.toISOString());
  }
});
