import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyGuidedStart, parseGuidedStart, completeJourneyStep, JOURNEY_STEPS, situationRoute } from '../src/lib/guidedStart';
import { createGuidedStartStore } from '../src/storage/guidedStartStore';
import { checkInFeedback } from '../src/lib/checkInFeedback';

test('strict corruption/version validation and sequential explicit completion', () => {
  assert.throws(() => parseGuidedStart('{'));
  assert.throws(() => parseGuidedStart('{"version":2}'));
  assert.throws(() => parseGuidedStart(JSON.stringify({version:1,situation:'bogus',completed:[]})));
  let value = emptyGuidedStart();
  assert.deepEqual(completeJourneyStep(value, 'practice'), value);
  for (const step of JOURNEY_STEPS) value = completeJourneyStep(value, step);
  assert.deepEqual(value.completed, JOURNEY_STEPS);
  assert.deepEqual(completeJourneyStep(value, 'support'), value);
  assert.equal(situationRoute('urgent'), '/safety-wallet');
});

test('account isolation, restart, concurrent sibling edits, failed write and corruption recovery', async () => {
  const data = new Map<string,string>(); let fail = false;
  const io = { getItem: async (k:string) => data.get(k) ?? null, setItem: async(k:string,v:string) => { if(fail) throw Error('disk'); data.set(k,v); } };
  const store = createGuidedStartStore(io);
  await Promise.all([store.load('a'),store.load('b')]);
  await Promise.all([store.edit('a',v=>({...v,situation:'worried'})),store.edit('a',v=>completeJourneyStep(v,'understand'))]);
  assert.equal(store.snapshot('a').value.situation,'worried');
  assert.deepEqual(store.snapshot('a').value.completed,['understand']);
  assert.equal(store.snapshot('b').value.situation,null);
  const restart = createGuidedStartStore(io); await restart.load('a');
  assert.deepEqual(restart.snapshot('a').value,store.snapshot('a').value);
  fail=true; await assert.rejects(store.edit('a',v=>({...v,situation:'boundaries'})));
  assert.equal(store.snapshot('a').value.situation,'worried'); fail=false;
  const key=[...data.keys()][0]; data.set(key,'broken');
  const corrupt=createGuidedStartStore(io); await corrupt.load('a');
  assert.ok(corrupt.snapshot('a').error); await assert.rejects(corrupt.edit('a',v=>v));
  await corrupt.reset('a'); assert.equal(corrupt.snapshot('a').error,null);
  const clean=createGuidedStartStore(io); await clean.load('a'); assert.deepEqual(clean.snapshot('a').value,emptyGuidedStart());
});

test('a mutating updater cannot publish unsaved values after a failed write', async () => {
  const store = createGuidedStartStore({ getItem: async () => null, setItem: async () => { throw Error('disk'); } });
  await store.load('a');
  await assert.rejects(store.edit('a', value => { value.situation = 'worried'; value.completed.push('understand'); return value; }));
  assert.deepEqual(store.snapshot('a').value, emptyGuidedStart());
});

test('delayed writes, reload, and reset are serialized without resurrecting progress', async () => {
  let raw: string | null = null; let release!: () => void;
  let block = true;
  const store = createGuidedStartStore({ getItem: async () => raw, setItem: async (_k, value) => {
    if (block) { block = false; await new Promise<void>(resolve => { release = resolve; }); }
    raw = value;
  } });
  await store.load('a');
  const edit = store.edit('a', v => completeJourneyStep(v, 'understand'));
  await new Promise(resolve => setImmediate(resolve));
  const reload = store.load('a'); const reset = store.reset('a');
  assert.deepEqual(store.snapshot('a').value, emptyGuidedStart());
  release(); await Promise.all([edit, reload, reset]);
  assert.deepEqual(store.snapshot('a').value, emptyGuidedStart());
  assert.deepEqual(parseGuidedStart(raw), emptyGuidedStart());
});

test('feedback follows saved answers with safety priority and useful optional actions', () => {
  const base={moodScore:3,capacityScore:3,pressureScore:3,supportNeed:'steady'} as const;
  assert.equal(checkInFeedback({...base,supportNeed:'safety',capacityScore:1,pressureScore:5}).key,'safety');
  assert.equal(checkInFeedback({...base,capacityScore:1,pressureScore:5}).key,'overloaded');
  assert.equal(checkInFeedback({...base,moodScore:1}).key,'lowMood');
  for(const supportNeed of ['rest','connection','boundary','plan','steady'] as const) {
    const result=checkInFeedback({...base,supportNeed}); assert.equal(result.key,supportNeed); assert.ok(result.route);
  }
});
