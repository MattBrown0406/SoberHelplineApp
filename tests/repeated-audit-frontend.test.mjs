import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

// Real transpiled modules and AST-extracted component callbacks. No network,
// production records or native renderer. Baseline mode never swaps worktree files.
const source = file => process.env.AUDIT_BASELINE_REF && file !== 'src/hooks/useAsyncScope.ts'
  ? execFileSync('git', ['show', `${process.env.AUDIT_BASELINE_REF}:${file}`], { encoding: 'utf8' })
  : fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
function declaration(file, name) {
  const text = source(file); const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  function visit(n) { if (ts.isFunctionDeclaration(n) && n.name?.text === name) found = n; ts.forEachChild(n, visit); }
  visit(ast); assert.ok(found, `${file}: ${name}`);
  return found.getText(ast).replace(/^export default /, '').replace(/^export /, '');
}
function callback(file, name, globals) {
  const context = vm.createContext(globals);
  vm.runInContext(compile(declaration(file, name)), context);
  return context[name];
}
function load(file, mocks) {
  const module = { exports: {} };
  vm.runInNewContext(compile(source(file)), { module, exports: module.exports, require(id) { assert.ok(id in mocks, id); return mocks[id]; }, console });
  return module.exports;
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function harness() {
  const slots = []; let cursor = 0; let effects = [];
  const equal = (a, b) => a && b && a.length === b.length && a.every((x, i) => x === b[i]);
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useMemo(fn, deps) { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) slots[i] = { value: fn(), deps }; return slots[i].value; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || !equal(slots[i].deps, deps)) { const old = slots[i]; slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[i].cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  return { react, read(fn) { cursor = 0; return fn(); }, async flush(fn) { for (let i = 0; i < 35; i++) { this.read(fn); const batch = effects; effects = []; batch.forEach(f => f()); await Promise.resolve(); } return this.read(fn); }, unmount() { slots.forEach(s => s?.cleanup?.()); } };
}

for (const [file, wrapper, child] of [
  ['app/chat.tsx', 'ChatScreen', 'ChatContent'], ['app/crisis-mode.tsx', 'CrisisModeScreen', 'CrisisModeContent'],
  ['app/trajectory.tsx', 'TrajectoryScreen', 'TrajectoryContent'],
  ['src/components/video/PremierVideoSchedulingCard.tsx', 'PremierVideoSchedulingCard', 'PremierVideoSchedulingCardContent'],
  ['src/components/video/PlanReviewBookingCard.tsx', 'PlanReviewBookingCard', 'PlanReviewBookingCardContent'],
]) test(`${wrapper}: private form lifetime is keyed to account, stable on token refresh`, () => {
  let user = { id: 'A' };
  const element = (type, props) => ({ type, props });
  const run = callback(file, wrapper, { React: { createElement: element }, useAccount: () => ({ user }), [child]: child });
  assert.equal(run({}).props.key, 'A'); user = { id: 'A', token: 'refresh' }; assert.equal(run({}).props.key, 'A');
  user = { id: 'B' }; assert.equal(run({}).props.key, 'B'); user = null; assert.equal(run({}).props.key, 'signed-out');
});

test('setup serial queue discards queued A profile and completion after unmount/account replacement', async () => {
  let active = true; const writes = []; const updates = []; const held = deferred();
  const createSerialQueue = callback('src/lib/invitationSetup.ts', 'createSerialQueue', {});
  const enqueue = callback('app/invitation-setup.tsx', 'enqueueSave', {
    accountId: 'A', isCurrent: () => active, saveQueue: { current: createSerialQueue() },
    saveLovedOneProfile: async p => { writes.push(p); return held.promise; },
    setDraft: v => updates.push(v), setSaveError: v => updates.push(v), captureAppError() {},
  });
  const one = enqueue({ name: 'PRIVATE-A-first' }, false); const two = enqueue({ name: 'PRIVATE-A-second' }, false);
  await tick(); assert.equal(writes.length, 1); active = false;
  held.resolve({ completedAt: null, updatedAt: 'now' }); await Promise.all([one, two]);
  assert.equal(writes.length, 1); assert.equal(updates.length, 0);
});

test('setup permission continuation never completes setup for the replacement identity', async () => {
  const held = deferred(); let active = true; const completions = []; const navigation = [];
  const finish = callback('app/invitation-setup.tsx', 'finishWithAlerts', {
    accountId: 'A', isCurrent: () => active, alertsOn: true, Platform: { OS: 'ios' },
    registerForPushNotifications: () => held.promise, completeInvitationSetup: async x => completions.push(x),
    router: { dismissTo: x => { navigation.push(x); } }, setSaving() {}, setSaveError() {}, setNoDevice() {}, captureAppError() {},
  });
  const done = finish(); active = false; held.resolve(true); await done;
  assert.equal(completions.length, 0); assert.equal(navigation.length, 0);
});

test('chat late send failure cannot restore A draft/attachments or alert B', async () => {
  const held = deferred(); let active = true; const changes = []; const alerts = [];
  const send = callback('app/chat.tsx', 'handleSend', {
    draft: 'PRIVATE-A', pendingAttachments: [{ uri: 'private-A' }], sending: false, isCurrent: () => active,
    setDraft: x => changes.push(x), setPendingAttachments: x => changes.push(x), send: () => held.promise,
    t: x => x, listRef: { current: null }, appAlert: x => alerts.push(x), AttachmentUploadError: class extends Error {},
  });
  const done = send(); changes.length = 0; active = false; held.reject(new Error('offline')); await done;
  assert.equal(changes.length, 0); assert.equal(alerts.length, 0);
});

for (const phase of ['permission', 'picker']) test(`chat ${phase} result is discarded after account lifetime ends`, async () => {
  const held = deferred(); let active = true; let launches = 0; const changes = [];
  const pick = callback('app/chat.tsx', 'pickAttachment', {
    isCurrent: () => active, t: x => x, appAlert: x => changes.push(x), setPendingAttachments: x => changes.push(x),
    ImagePicker: { requestMediaLibraryPermissionsAsync: () => phase === 'permission' ? held.promise : Promise.resolve({ granted: true }),
      launchImageLibraryAsync: () => { launches++; return phase === 'permission' ? Promise.resolve({ canceled: true }) : held.promise; }, MediaTypeOptions: { Images: 'images' } },
  });
  const done = pick(); await tick(); active = false;
  held.resolve(phase === 'permission' ? { granted: true } : { canceled: false, assets: [{ uri: 'PRIVATE-A' }] });
  await done; assert.equal(changes.length, 0); assert.equal(launches, phase === 'permission' ? 0 : 1);
});

for (const invalidation of ['unmount', 'blur', 'blur-and-return']) test(`outcome yes cannot hijack navigation after ${invalidation}`, async () => {
  const held = deferred(); let active = true; let focused = true; const generation = { current: 1 }; const nav = [];
  const log = callback('app/invitation-outcome.tsx', 'log', {
    user: { id: 'A' }, saving: false, isCurrent: () => active, focusGeneration: generation, navigation: { isFocused: () => focused },
    engine: { snapshot: { localDate: '2026-10-01', plan: { soberTimes: [] } }, forecast: null },
    askedOn: 'today', note: 'PRIVATE-A', lineStyle: null, askDate: x => x, suggestNextWindowDate: () => null,
    logInvitationAttempt: () => held.promise, router: { replace: x => { nav.push(x); } },
    setSaving() {}, setSaveError() {}, setLogged() {}, captureAppError() {},
  });
  const done = log('yes');
  if (invalidation === 'unmount') active = false;
  else { generation.current++; focused = invalidation === 'blur-and-return'; }
  held.resolve({ coachAlerted: true }); await done; assert.equal(nav.length, 0);
});

for (const [file, handler] of [
  ['src/components/video/PremierVideoSchedulingCard.tsx', 'submit'],
  ['src/components/video/PlanReviewBookingCard.tsx', 'submit'],
  ['src/components/video/PlanReviewBookingCard.tsx', 'submitRevision'],
]) test(`${file} ${handler}: stale private booking callbacks and completions are fenced`, async () => {
  let active = true; const held = deferred(); const writes = []; const changes = [];
  const request = input => { writes.push(input); return held.promise; };
  const run = callback(file, handler, {
    user: { id: 'A' }, isCurrent: () => active, startsAt: new Date('2099-01-01'), zone: 'UTC', note: 'PRIVATE-A', session: null,
    selected: ['safety'], consented: true, preview: true, previewFingerprint: 'same', consentFingerprint: 'same', fingerprint: 'same',
    existing: { id: 'A-session' }, detectedTimeZone: () => 'UTC', requestFocusReason: 'PRIVATE-A', requestQuestions: ['PRIVATE-A'], snapshot: {}, consentLocale: 'en', isPremier: true,
    k: x => x, appAlert: x => changes.push(x), setPreview: x => changes.push(x), setConsented: x => changes.push(x), setEditing: x => changes.push(x), setNote: x => changes.push(x),
    controller: { requestSession: request, requestPlanReview: request, submitPlanReviewRevision: request },
  });
  const done = run(); assert.equal(writes.length, 1); active = false; held.resolve({ id: 'saved' }); await done;
  assert.equal(changes.length, 0); await run(); assert.equal(writes.length, 1);
});

test('setup review does not start completion RPC after its awaited save outlives the screen', async () => {
  const held = deferred(); let active = true; const calls = [];
  const next = callback('app/invitation-setup.tsx', 'next', {
    isCurrent: () => active, draft: { safetyConcern: 'serious' }, saving: false, step: 'review', steps: ['review'],
    commitPending: () => ({ safetyConcern: 'serious' }), persist: () => held.promise, engine: { hasAccess: true },
    completeInvitationSetup: async () => calls.push('complete'), setFinished: () => calls.push('finished'), setSafetyMissing() {}, setStepIndex() {}, captureAppError() {},
  });
  const done = next(); active = false; held.resolve(true); await done; assert.equal(calls.length, 0);
});

function threadFixture() {
  const h = harness(); let tid = 'old'; const subscriptions = []; const signed = deferred(); const sent = [];
  const supabase = {
    from(table) {
      const chain = {}; let inserted;
      for (const method of ['select', 'eq', 'is', 'order', 'limit', 'in']) chain[method] = () => chain;
      chain.insert = p => { inserted = p; sent.push(p); return chain; };
      chain.maybeSingle = async () => ({ data: table === 'consents' ? { granted_at: '2026-10-01', revoked_at: null } : { id: tid }, error: null });
      chain.single = async () => ({ data: { id: 'sent', ...inserted, created_at: '2026-10-01' }, error: null });
      chain.then = (a, b) => Promise.resolve({ data: [], error: null }).then(a, b);
      return chain;
    },
    channel() { const callbacks = []; subscriptions.push(callbacks); return { on(_, filter, fn) { callbacks.push({ ...filter, fn }); return this; }, subscribe() { return this; } }; },
    removeChannel() {}, rpc: async () => { tid = 'new'; return { error: null }; },
    storage: { from: () => ({ createSignedUrl: () => signed.promise }) },
  };
  const useThread = load('src/hooks/useThread.ts', {
    react: h.react, 'react-native': { AppState: { addEventListener: () => ({ remove() {} }) } }, 'expo-file-system/legacy': {},
    '../lib/supabase': { supabase }, '../lib/realtimeTopics': { threadChannelTopic: x => x },
    './useAsyncScope': load('src/hooks/useAsyncScope.ts', { react: h.react }),
  }).useThread;
  const render = () => useThread('A', true);
  return { h, useThread, supabase, subscriptions, signed, sent, read: () => h.read(render), flush: () => h.flush(render) };
}

test('archived subscription messages/reactions and delayed signatures cannot contaminate reopened same-account thread', async () => {
  const f = threadFixture(); await f.flush(); const old = f.subscriptions[0];
  old.find(x => x.table === 'message_attachments').fn({ new: { id: 'a-old', message_id: 'new-message', storage_path: 'private-old' } });
  await f.read().archive(); await f.flush(); assert.equal(f.read().threadId, 'new');
  old.find(x => x.table === 'messages').fn({ new: { id: 'old-message', body: 'PRIVATE-OLD', created_at: '2026-10-01' } });
  old.find(x => x.table === 'message_reactions' && x.event === 'INSERT').fn({ new: { id: 'r-old', message_id: 'new-message', account_id: 'A', reaction: '❤️' } });
  const latest = f.subscriptions.at(-1);
  latest.find(x => x.table === 'messages').fn({ new: { id: 'new-message', body: 'CURRENT', created_at: '2026-10-01' } });
  f.signed.resolve({ data: { signedUrl: 'PRIVATE-OLD' } }); await f.flush();
  assert.equal(f.read().messages.length, 1); assert.equal(f.read().messages[0].attachments.length, 0); assert.equal(f.read().messages[0].reactions.length, 0);
  f.h.unmount();
});

test('trajectory first share sends once using the real enabled hook, never the old disabled send', async () => {
  const f = threadFixture(); const h = f.h; const alerts = [];
  const native = new Proxy({ StyleSheet: { create: x => x } }, { get: (o, k) => o[k] ?? k });
  const mod = load('app/trajectory.tsx', {
    react: { ...h.react, default: h.react }, 'react-native': native, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { useRouter: () => ({}) }, 'react-i18next': { useTranslation: () => ({ t: (x, opts) => opts?.returnObjects ? [] : x }) },
    '../src/contexts/ThemeContext': { useTheme: () => ({ colors: {} }) },
    '../src/contexts/AccountContext': { useAccount: () => ({ user: { id: 'A' }, entitlements: { canMessageOnCallCoach: true } }) },
    '../src/hooks/useAsyncScope': load('src/hooks/useAsyncScope.ts', { react: h.react }),
    '../src/hooks/useTrajectory': { useTrajectory: () => ({ points: [], loading: false, trend: 'steady' }) },
    '../src/hooks/useThread': { useThread: f.useThread }, '../src/lib/supabase': { supabase: f.supabase },
    '../src/lib/appAlert': { appAlert: x => alerts.push(x) }, '../src/components/ui/ScreenContainer': { MAX_CONTENT_WIDTH: 800 },
  });
  const render = () => { const root = mod.default(); return typeof root.type === 'function' ? root.type(root.props) : root; };
  const walk = node => !node || typeof node !== 'object' ? [] : [node, ...(node.props?.children ?? []).flat(Infinity).flatMap(walk)];
  const tree = await h.flush(render);
  const button = walk(tree).find(x => x.props?.onPress && JSON.stringify(x.props.children).includes('trajectory.shareButton'));
  assert.ok(button, 'share control'); button.props.onPress(); await h.flush(render); await tick();
  assert.equal(f.sent.filter(x => x.body === 'trajectory.shareMessage').length, 1); assert.equal(alerts.length, 0);
  h.unmount();
});
