import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

// Execute the actual screen callbacks, not copied implementations. Native UI,
// network and React state setters are replaced with deterministic test doubles.
function action(file, name, bindings, kind = 'function') {
  bindings = { submissionScope: { current: { accountId: bindings.user?.id } }, ...bindings };
  const source = process.env.AUDIT_SCREENS_BASELINE
    ? execFileSync('git', ['show', `HEAD:app/${file}`], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' })
    : readFileSync(new URL(`../app/${file}`, import.meta.url), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (kind === 'function' && ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node.getText(tree);
    if (kind === 'callback' && ts.isVariableDeclaration(node) && node.name.getText(tree) === name) expression = node.initializer.arguments[0].getText(tree);
    if (kind === 'effect' && ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect') expression ??= node.arguments[0].getText(tree);
    if (kind === 'navigation' && ts.isJsxAttribute(node) && node.name.text === 'onPress' && node.initializer?.expression?.getText(tree).includes('dismiss')) expression = node.initializer.expression.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.ok(expression, `Missing ${name} in ${file}`);
  const output = ts.transpileModule(`const action = (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(bindings), `${output}\nreturn action;`)(...Object.values(bindings));
}

function stateBindings(initial = {}) {
  const state = { ...initial };
  const bindings = {};
  for (const key of ['Submitting', 'Submitted', 'SubmitError', 'SelectedDate', 'SelectedPeriod', 'Contact', 'Note', 'Bookings', 'Sessions', 'Loading', 'LoadError', 'Provider']) {
    bindings[`set${key}`] = value => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  }
  return { state, bindings };
}
function query(result) {
  const filters = [];
  const chain = {
    select() { return chain; }, order() { return chain; }, delete() { return chain; },
    eq(...args) { filters.push(args); return chain; },
    limit() { return chain; },
    then(resolve, reject) { return Promise.resolve().then(() => typeof result === 'function' ? result() : result).then(resolve, reject); },
  };
  return { supabase: { from: () => chain }, filters };
}

for (const failure of ['database error', 'rejection']) {
  test(`coaching ${failure} preserves form, clears old success and releases spinner`, async () => {
    const { state, bindings } = stateBindings({ Submitted: true, SelectedDate: 'kept', Note: 'kept' });
    const handle = action('book-coaching.tsx', 'handleSubmit', {
      ...bindings, user: { id: 'account-a' }, canSubmit: true, submitting: false,
      selectedDate: new Date(), selectedPeriod: 'morning', formatDateChip: () => 'Sep 7', t: key => key,
      contact: '555', note: 'Draft', load: () => assert.fail('Failed insert must not refresh as success'),
      supabase: { from: () => ({ insert: async () => { if (failure === 'rejection') throw Error('offline'); return { error: Error('denied') }; } }) },
    });
    await handle();
    assert.equal(state.SubmitError, true);
    assert.equal(state.Submitting, false);
    assert.equal(state.Submitted, false);
    assert.equal(state.SelectedDate, 'kept');
    assert.equal(state.Note, 'kept');
  });
}

test('coaching successful insert clears form and refreshes bookings', async () => {
  const { state, bindings } = stateBindings();
  let refreshed = false;
  let payload;
  await action('book-coaching.tsx', 'handleSubmit', {
    ...bindings, user: { id: 'account-a' }, canSubmit: true, submitting: false,
    selectedDate: new Date(), selectedPeriod: 'morning', formatDateChip: () => 'Sep 7', t: key => key,
    contact: ' 555 ', note: ' Draft ', load: () => { refreshed = true; },
    supabase: { from: () => ({ insert: async value => { payload = value; return { error: null }; } }) },
  })();
  assert.equal(payload.account_id, 'account-a');
  assert.equal(payload.note, 'Contact: 555\n\nDraft');
  assert.equal(state.Submitted, true);
  assert.equal(state.Submitting, false);
  assert.equal(state.Note, '');
  assert.equal(refreshed, true);
});

for (const file of ['book-coaching.tsx', 'rehearsal-history.tsx']) {
  test(`${file}: query failure is an error rather than empty history`, async () => {
    const { state, bindings } = stateBindings({ Bookings: ['existing'], Sessions: ['existing'] });
    const db = query({ data: null, error: Error('offline') });
    await action(file, 'load', { ...bindings, ...db, user: { id: 'account-a' }, loadRequest: { current: 0 } }, 'callback')();
    assert.equal(state.LoadError, true);
    assert.deepEqual(state.Bookings, ['existing']);
    assert.deepEqual(state.Sessions, ['existing']);
    assert.deepEqual(db.filters, [['account_id', 'account-a']]);
    if (file === 'rehearsal-history.tsx') assert.equal(state.Loading, false);
  });
  test(`${file}: invalidated request cannot replace newer account data`, async () => {
    const { state, bindings } = stateBindings({ Bookings: ['new'], Sessions: ['new'] });
    const request = { current: 0 };
    let resolve;
    const pending = new Promise(done => { resolve = done; });
    const load = action(file, 'load', { ...bindings, ...query(() => pending), user: { id: 'old' }, loadRequest: request }, 'callback');
    const work = load();
    ++request.current;
    resolve({ data: ['old'], error: null });
    await work;
    assert.deepEqual(state.Bookings, ['new']);
    assert.deepEqual(state.Sessions, ['new']);
  });
}

for (const failure of [false, true]) {
  test(`rehearsal delete ${failure ? 'failure retains' : 'success removes'} the visible session`, async () => {
    const { state, bindings } = stateBindings({ Sessions: [{ id: 'a' }, { id: 'b' }] });
    const alerts = [];
    action('rehearsal-history.tsx', 'confirmDelete', {
      ...bindings, ...query({ error: failure ? Error('denied') : null }), t: key => key,
      Alert: { alert: (...args) => alerts.push(args) },
    })('a');
    await alerts[0][2].find(button => button.style === 'destructive').onPress();
    await new Promise(done => setImmediate(done));
    assert.deepEqual(state.Sessions.map(row => row.id), failure ? ['a', 'b'] : ['b']);
    assert.equal(alerts.length, failure ? 2 : 1);
  });
}

test('provider detail ignores responses after route cleanup', async () => {
  const { state, bindings } = stateBindings();
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const cleanup = action('finder/[id].tsx', 'useEffect', { ...bindings, id: 'a', fetchProviderById: () => pending }, 'effect')();
  assert.equal(state.Loading, true);
  assert.equal(typeof cleanup, 'function');
  cleanup();
  resolve({ id: 'a' });
  await new Promise(done => setImmediate(done));
  assert.equal(state.Provider, undefined);
});

test('provider detail rejection exits loading and exposes retry error', async () => {
  const { state, bindings } = stateBindings();
  action('finder/[id].tsx', 'useEffect', { ...bindings, id: 'a', fetchProviderById: async () => { throw Error('offline'); } }, 'effect')();
  await new Promise(done => setImmediate(done));
  assert.equal(state.LoadError, true);
  assert.equal(state.Loading, false);
});

test('inquiry return targets existing finder without dismiss-all plus replacement', () => {
  const calls = [];
  action('finder/inquiry.tsx', 'onPress', { router: {
    dismissTo: path => { calls.push(['dismissTo', path]); },
    dismissAll: () => { calls.push(['dismissAll']); },
    replace: path => { calls.push(['replace', path]); },
  } }, 'navigation')();
  assert.deepEqual(calls, [['dismissTo', '/finder']]);
});

test('late coaching submission cannot clear or reload another account', async () => {
  const {state,bindings}=stateBindings({Note:'old'});let resolve;
  const pending=new Promise(done=>{resolve=done});const submissionScope={current:{accountId:'A'}};
  const work=action('book-coaching.tsx','handleSubmit',{
    ...bindings,submissionScope,user:{id:'A'},canSubmit:true,submitting:false,
    selectedDate:new Date(),selectedPeriod:'morning',formatDateChip:()=> 'date',t:k=>k,contact:'',note:'old',
    load:()=>assert.fail('must not load old account'),supabase:{from:()=>({insert:()=>pending})}
  })();
  submissionScope.current={accountId:'B'};state.Note='new account draft';state.Submitted=false;state.Submitting=true;
  resolve({error:null});await work;
  assert.equal(state.Note,'new account draft');assert.equal(state.Submitted,false);assert.equal(state.Submitting,true);
});
test('signup releases loading on rejection and never queries account tables anonymously',async()=>{
 const state={};await action('(auth)/sign-up.tsx','handleEmailSignUp',{
  loading:false,acceptedTerms:true,password:'longpassword',email:'test@example.test',firstName:'Test',lastName:'Audit',TERMS_VERSION:'1.0',t:k=>k,
  setError:v=>state.error=v,setLoading:v=>state.loading=v,setCheckEmail:v=>state.check=v,
  supabase:{auth:{signUp:async()=>{throw Error('offline')}},from:()=>assert.fail('anonymous account lookup')}
 })();assert.equal(state.loading,false);assert.equal(state.error,'signUp.errorGeneric');assert.equal(state.check,undefined);
});
test('confirmation-required signup displays email instructions without account-table access',async()=>{
 const state={};await action('(auth)/sign-up.tsx','handleEmailSignUp',{
  loading:false,acceptedTerms:true,password:'longpassword',email:'test@example.test',firstName:'Test',lastName:'Audit',TERMS_VERSION:'1.0',t:k=>k,
  setError:v=>state.error=v,setLoading:v=>state.loading=v,setCheckEmail:v=>state.check=v,
  supabase:{auth:{signUp:async()=>({data:{user:{id:'A'},session:null},error:null})},from:()=>assert.fail('anonymous account lookup')}
 })();assert.equal(state.loading,false);assert.equal(state.check,true);assert.equal(state.error,null);
});
