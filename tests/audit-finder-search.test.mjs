import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Deterministic hook scheduler: execute real transpiled client modules with
// isolated React hooks/native IO. No production client or credentials are loaded.
function harness() {
  const slots = []; let index = 0; let effects = []; let renderFn;
  const equal = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    createElement: (type, props) => ({ type, props }),
    useContext: () => null,
    useState(initial) {
      const i = index++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], (v) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }];
    },
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
    useCallback(fn, deps) {
      const i = index++; if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { fn, deps }; return slots[i].fn;
    },
    useEffect(fn, deps) {
      const i = index++;
      if (!slots[i] || !equal(slots[i].deps, deps)) {
        const old = slots[i]; slots[i] = { deps, cleanup: old?.cleanup };
        effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); });
      }
    },
  };
  return {
    react,
    render(fn = renderFn) { renderFn = fn; index = 0; return fn(); },
    effects() { const pending = effects; effects = []; pending.forEach((fn) => fn()); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}
function load(path, mocks = {}) {
  const file = new URL(`../${path}`, import.meta.url);
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module, exports: module.exports, require(id) {
      if (!(id in mocks)) throw new Error(`Unexpected dependency: ${id}`);
      return mocks[id];
    }, console, setTimeout, clearTimeout, Intl, Date,
  }, { filename: file.pathname });
  return module.exports;
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

function fixture(fetchProviders) {
  const h = harness();
  const { useProviderSearch } = load('src/hooks/useProviderSearch.ts', { react: h.react, '../api/providers': { fetchProviders } });
  const read = () => h.render(useProviderSearch);
  read(); h.effects();
  return { h, read };
}
test('finder errors are distinct from empty results and can be retried', async () => {
  let fail = true;
  const f = fixture(async () => { if (fail) throw new Error('offline'); return [{id:'real'}]; });
  await settle(); assert.match(f.read().error, /offline/); assert.equal(f.read().loading,false);
  fail=false; f.read().retry(); f.read(); f.h.effects(); await settle();
  assert.equal(f.read().error,null); assert.equal(f.read().results[0].id,'real');
});
test('finder invalidates old responses when filters change', async () => {
  const old=deferred();
  const f=fixture(async (type,opts) => opts.state ? [{id:'new'}] : old.promise);
  f.read().setField('state','Oregon'); f.read(); f.h.effects(); await settle();
  old.resolve([{id:'old'}]); await settle(); assert.equal(f.read().results[0].id,'new');
});
test('optional directory requests cannot hide successful main results', async () => {
  const f=fixture(async (type) => { if(type !== 'center') throw new Error('optional outage'); return [{id:'main'}]; });
  await settle(); assert.equal(f.read().error,null);assert.equal(f.read().results[0].id,'main');
});
test('switching away from centers clears hidden insurance filters', async () => {
  const calls=[];const f=fixture(async (type,opts)=>{calls.push({type,opts});return [];}); await settle();
  f.read().toggleField('insurance','Aetna');f.read();f.h.effects();await settle();
  f.read().setPath('coach');f.read();f.h.effects();await settle();
  assert.equal(f.read().filters.insurance.length,0);
  assert.equal(calls.at(-1).opts.insurance,undefined);
});
test('directory does not display unsupported matching controls', () => {
  const source=fs.readFileSync(new URL('../app/finder/index.tsx',import.meta.url),'utf8');
  for(const key of ['budgetIdx','filters.zip','filters.age','filters.gender','filters.conditions','filters.modalities','filters.populations']) assert.equal(source.includes(key),false,key);
  assert.match(source,/onPress=\{retry\}/);
});
