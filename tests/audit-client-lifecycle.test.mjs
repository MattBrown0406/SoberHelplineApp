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
const monitoring = { captureAppError() {}, addAppBreadcrumb() {} };
function authFixture() {
  const h = harness(); const session = deferred(); const accountRead = deferred(); const cached = deferred(); let listener;
  const { AccountProvider } = load('src/contexts/AccountContext.tsx', {
    react: { ...h.react, default: h.react },
    '../lib/supabase': { supabase: {
      auth: { getSession: () => session.promise, onAuthStateChange(fn) { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; } },
      from: () => ({ select: () => ({ eq: () => ({ single: () => accountRead.promise }) }) }),
    } },
    '../lib/admin': { isAdminEmail: () => false },
    '../lib/revenueCat': { resetRevenueCatUser: async () => {} },
    '../lib/authBootstrap': load('src/lib/authBootstrap.ts'),
    '../lib/monitoring': monitoring,
    '../lib/featureAccess': { entitlementsForAccountState: () => ({}) },
    '../lib/offlineAccountCache': {
      cacheSuccessfulAccount: async () => {}, clearLastOfflineAccount: async () => {}, clearOfflineAccount: async () => {},
      isOfflineFallbackError: () => true, restoreOfflineAccount: () => cached.promise, restoreLastOfflineAccount: () => cached.promise,
    },
  });
  const read = () => h.render(() => AccountProvider({ children: null })).props.value;
  read(); h.effects();
  return { h, read, session, accountRead, cached, event: (...args) => listener(...args) };
}

test('offline profile is hidden immediately when a new session signs in', async () => {
  const f = authFixture();
  f.session.resolve({ data: { session: null }, error: new Error('offline') });
  f.cached.resolve({ id: 'account-A', accountState: 'direct-free', entitlements: {} });
  await settle(); assert.equal(f.read().user.id, 'account-A');
  f.event('SIGNED_IN', { user: { id: 'principal-B' } });
  assert.equal(f.read().user, null);
  f.h.unmount(); f.accountRead.resolve({ data: null, error: new Error('offline') }); await settle();
});

test('stale offline bootstrap miss cannot overwrite the next session loading/error state', async () => {
  const f = authFixture();
  f.event('SIGNED_IN', { user: { id: 'principal-A' } });
  f.accountRead.resolve({ data: null, error: new Error('offline') }); await settle();
  f.event('SIGNED_OUT', null); f.event('SIGNED_IN', { user: { id: 'principal-B' } });
  // Leave B's own cache lookup pending too; use unmount to fence both callbacks.
  f.h.unmount(); f.cached.resolve(null); await settle();
  assert.equal(f.read().isLoading, true);
  assert.equal(f.read().accountError, null);
});

test('initial session cache miss cannot stop loading a newer sign-in', async () => {
  const f = authFixture();
  f.session.resolve({ data: { session: null }, error: new Error('offline') }); await settle();
  f.event('SIGNED_IN', { user: { id: 'principal-B' } });
  f.cached.resolve(null); await settle();
  assert.equal(f.read().isLoading, true);
  f.h.unmount(); f.accountRead.resolve({ data: null, error: new Error('offline') }); await settle();
});

function safetyFixture(io = {}) {
  const h = harness(); let owner = 'A'; const pending = []; const writes = [];
  const safety = load('src/lib/safetyWallet.ts');
  const { useSafetyWallet } = load('src/hooks/useSafetyWallet.ts', {
    react: { ...h.react, default: h.react }, '../lib/monitoring': monitoring, '../lib/safetyWallet': safety,
    '@react-native-async-storage/async-storage': { default: {
      getItem(key) { const d = deferred(); pending.push({ key, ...d }); return d.promise; },
      setItem: async (key, value) => { writes.push({ key, value }); if (io.setItem) await io.setItem(key, value); },
      removeItem: async (key) => { if (io.removeItem) await io.removeItem(key); },
    } },
  });
  const read = () => h.render(() => useSafetyWallet(owner, true));
  read(); h.effects();
  return { h, read, pending, writes, switchTo(id) { owner = id; }, safety };
}

test('safety wallet never renders the previous account plan during account hydration', async () => {
  const f = safetyFixture(); await settle();
  f.pending.splice(0).forEach((d) => d.resolve(d.key.endsWith('plan') ? JSON.stringify({ ...f.safety.DEFAULT_SAFETY_PLAN, safeAdult: 'private-A' }) : null));
  await settle(); const a = f.read(); f.h.effects();
  assert.equal(a.plan.safeAdult, 'private-A');
  f.switchTo('B'); assert.notEqual(f.read().plan.safeAdult, 'private-A');
  f.h.effects(); f.h.unmount();
});

test('failed safety hydration preserves disk records and supports an explicit retry', async () => {
  const f = safetyFixture(); await settle();
  f.pending.splice(0).forEach((d) => d.reject(new Error('disk unavailable')));
  await settle(); const failed = f.read(); f.h.effects(); await settle();
  assert.equal(f.writes.length, 0);
  assert.ok(failed.loadError);
  assert.equal(failed.hydrated, false);
  failed.reload(); f.read(); f.h.effects(); await settle();
  f.pending.splice(0).forEach((d) => d.resolve(null)); await settle();
  assert.equal(f.read().hydrated, true);
  assert.equal(f.read().loadError, null);
  f.h.unmount();
});

test('safety autosaves are ordered and clearing waits for older writes', async () => {
  const blocked = deferred(); const disk = new Map(); let block = false;
  const f = safetyFixture({
    async setItem(key, value) { if (block) { block = false; await blocked.promise; } disk.set(key, value); },
    async removeItem(key) { disk.delete(key); },
  });
  await settle(); f.pending.splice(0).forEach((d) => d.resolve(null)); await settle();
  f.read(); f.h.effects(); await settle();
  block = true;
  f.read().setPlan((p) => ({ ...p, safeAdult: 'older edit' })); f.read(); f.h.effects(); await settle();
  f.read().setPlan((p) => ({ ...p, safeAdult: 'newer edit' })); f.read(); f.h.effects(); await settle();
  assert.equal(f.writes.filter((w) => w.value.includes('newer edit')).length, 0);
  const clear = f.read().clear(); await settle();
  blocked.resolve(); await clear; await settle();
  assert.equal(disk.size, 0);
  assert.equal(f.read().plan.safeAdult, ''); f.h.unmount();
});

test('wallet rejects edits before hydration and corrupt records never autosave', async () => {
  const f = safetyFixture();
  f.read().setPlan((p) => ({ ...p, safeAdult: 'premature' }));
  await settle();
  f.pending.splice(0).forEach((d) => d.resolve(d.key.endsWith('plan') ? '{broken' : null));
  await settle();
  assert.ok(f.read().loadError);
  assert.equal(f.read().hydrated, false);
  f.read().setPlan((p) => ({ ...p, safeAdult: 'overwrite' }));
  await settle(); assert.equal(f.writes.length, 0); f.h.unmount();
});

test('two mounted wallets merge callback edits and clear cannot resurrect sibling state', async () => {
  const a = harness(); const b = harness(); let current = a; const disk = new Map();
  const safety = load('src/lib/safetyWallet.ts');
  const react = Object.fromEntries(Object.keys(a.react).map((key) => [key, (...args) => current.react[key](...args)]));
  const { useSafetyWallet } = load('src/hooks/useSafetyWallet.ts', {
    react, '../lib/monitoring': monitoring, '../lib/safetyWallet': safety,
    '@react-native-async-storage/async-storage': { default: {
      getItem: async (key) => disk.get(key) ?? null,
      setItem: async (key, value) => { disk.set(key, value); },
      removeItem: async (key) => { disk.delete(key); },
    } },
  });
  const read = (h) => { current = h; return h.render(() => useSafetyWallet('A', true)); };
  read(a); a.effects(); read(b); b.effects(); await settle();
  const staleSibling = read(b);
  read(a).setPlan((p) => ({ ...p, safeAdult: 'adult' }));
  staleSibling.setPlan((p) => ({ ...p, preferredHospital: 'hospital' }));
  await settle();
  assert.equal(read(a).plan.safeAdult, 'adult');
  assert.equal(read(b).plan.preferredHospital, 'hospital');
  const clearing = read(a).clear();
  staleSibling.setPlan((p) => ({ ...p, safeAdult: 'resurrect' }));
  await clearing; await settle();
  assert.equal(disk.size, 0);
  assert.equal(read(b).plan.safeAdult, '');
  read(b).setPlan((p) => ({ ...p, preferredHospital: 'after clear' }));
  await settle();
  assert.equal(JSON.parse(disk.get(safety.safetyStorageKey('A', 'plan'))).safeAdult, '');
  a.unmount(); b.unmount();
});

test('provider API distinguishes DB failure from missing and never invents availability or PHP/IOP', async () => {
  let result = { data: null, error: new Error('database offline') };
  const api = load('src/api/providers.ts', { '@supabase/supabase-js': { createClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }),
  }) } });
  await assert.rejects(api.fetchProviderById('id'), /database offline/);
  result = { data: null, error: null }; assert.equal(await api.fetchProviderById('id'), undefined);
  result = { data: { id: 'id', provider_name: 'Clinic', category: 'Outpatient Treatment' }, error: null };
  const provider = await api.fetchProviderById('id');
  assert.equal(provider.availability, 'unverified');
  assert.deepEqual([...provider.levels], ['Outpatient']);
  assert.ok(!api.LOC_OPTIONS.center.includes('php'));
  assert.ok(!api.LOC_OPTIONS.center.includes('iop'));
});

function lovedOneFixture() {
  const h = harness(); let owner = 'A'; const reads = []; const saves = []; const statuses = [];
  const request = (list) => { const d = deferred(); list.push(d); return d.promise; };
  const { useLovedOne } = load('src/hooks/useLovedOne.ts', {
    react: h.react, '../lib/monitoring': monitoring,
    '../lib/appFlowGuards': load('src/lib/appFlowGuards.ts'),
    '../lib/supabase': { supabase: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => request(reads) }) }),
        upsert: () => ({ select: () => ({ single: () => request(saves) }) }),
      }),
      rpc: () => request(statuses),
    } },
  });
  const read = () => h.render(() => useLovedOne(owner)); read(); h.effects();
  return { h, read, reads, saves, statuses, switchTo(id) { owner = id; } };
}

test('loved-one load failure exits loading and refresh exposes recoverable errors', async () => {
  const f = lovedOneFixture();
  f.reads.shift().resolve({ data: null, error: new Error('offline') }); await settle();
  assert.equal(f.read().loading, false); assert.ok(f.read().loadError);
  const refresh = f.read().refresh();
  f.reads.shift().resolve({ data: { id: 'A', account_id: 'A' }, error: null }); await refresh;
  assert.equal(f.read().loading, false); assert.equal(f.read().loadError, null);
  f.h.unmount();
});

test('wallet old-account callbacks cannot write or clear after a switch', async () => {
  const f = safetyFixture(); await settle();
  f.pending.splice(0).forEach((d) => d.resolve(null)); await settle();
  const old = f.read();
  f.switchTo('B'); f.read();
  old.setPlan((p) => ({ ...p, safeAdult: 'stale' })); await old.clear();
  await settle(); assert.equal(f.writes.length, 0);
  f.h.effects(); f.h.unmount();
});

test('loved-one identity is masked on switch and late old-account reads are discarded', async () => {
  const f = lovedOneFixture();
  f.reads.shift().resolve({ data: { id: 'private-A', account_id: 'A' }, error: null }); await settle();
  assert.equal(f.read().lovedOne.id, 'private-A');
  const oldRefresh = f.read().refresh(); const oldRead = f.reads.shift();
  f.switchTo('B'); assert.equal(f.read().lovedOne, null); f.h.effects();
  f.reads.shift().resolve({ data: { id: 'private-B', account_id: 'B' }, error: null }); await settle();
  oldRead.resolve({ data: { id: 'private-A', account_id: 'A' }, error: null }); await oldRefresh;
  assert.equal(f.read().lovedOne.id, 'private-B'); f.h.unmount();
});

test('an older loved-one refresh cannot overwrite a saved edit', async () => {
  const f = lovedOneFixture(); const oldRead = f.reads.shift();
  const save = f.read().save({ first_name: 'new name' });
  f.saves.shift().resolve({ data: { id: 'A', account_id: 'A', first_name: 'new name' }, error: null }); await save;
  oldRead.resolve({ data: { id: 'A', account_id: 'A', first_name: 'old name' }, error: null }); await settle();
  assert.equal(f.read().lovedOne.first_name, 'new name'); f.h.unmount();
});

test('failed loved-one status updates reject without changing the displayed status', async () => {
  const f = lovedOneFixture();
  f.reads.shift().resolve({ data: { id: 'A', account_id: 'A', status: 'stable' }, error: null }); await settle();
  const update = f.read().setStatus('crisis');
  assert.equal(f.read().lovedOne.status, 'stable');
  f.statuses.shift().resolve({ error: new Error('permission denied') });
  await assert.rejects(update, /permission denied/);
  assert.equal(f.read().lovedOne.status, 'stable'); f.h.unmount();
});

test('late loved-one saves cannot populate a switched account', async () => {
  const f = lovedOneFixture();
  const save = f.read().save({ first_name: 'private-A' });
  f.switchTo('B'); f.read(); f.h.effects();
  f.saves.shift().resolve({ data: { id: 'A', account_id: 'A', first_name: 'private-A' }, error: null }); await save;
  assert.equal(f.read().lovedOne, null); f.h.unmount();
});
