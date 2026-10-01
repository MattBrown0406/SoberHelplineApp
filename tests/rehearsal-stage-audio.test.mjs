import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';

// Execute actual audio hooks, transition handlers and debrief effects, not a
// duplicate playback implementation. SDK/hook doubles are not native UI tests.
// Snapshot the uncommitted integration and set REHEARSAL_STAGE_BASELINE_DIR to
// prove regressions without replacing files in the shared checkout.
const root = process.env.REHEARSAL_STAGE_BASELINE_DIR || path.resolve(import.meta.dirname, '..');
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function screen(kind, os, delayed) {
  const file = `app/rehearsal-${kind}.tsx`;
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name.text === (kind === 'live' ? 'RehearsalLiveContent' : 'RehearsalIncomingContent'));
  const statements = component.body.statements;
  const start = statements.findIndex(n => n.getText(ast).startsWith('const audioGeneration ='));
  const end = statements.findIndex(n => n.getText(ast).startsWith('const playAudio ='));
  const audioCode = statements.slice(start, end + 1).map(n => n.getText(ast)).join('\n');
  const handlers = statements.filter(n => ts.isFunctionDeclaration(n)).map(n => n.getText(ast)).join('\n');
  const debriefEffect = statements.find(n => n.getText(ast).startsWith('useEffect(') && n.getText(ast).includes('handledDebriefRef.current === debrief')).getText(ast);
  const slots = [], pendingEffects = []; let cursor = 0;
  const gate = deferred(), sounds = []; let creates = 0;
  const scope = {
    stage: kind === 'live' ? 'chat' : 'call', safetyBreak: false,
    active: { voiceOn: true, warmup: true }, soundRef: { current: null },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((v, k) => v !== slots[i].deps[k])) slots[i] = { deps, fn }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++; const old = slots[i]; if (!old || deps.some((v, k) => v !== old.deps[k])) pendingEffects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
    Audio: { setAudioModeAsync: async () => {}, Sound: { createAsync: async (_, options) => {
      const index = creates++;
      const sound = { plays: options.shouldPlay ? 1 : 0, unloads: 0, async playAsync() { this.plays++; }, async unloadAsync() { this.unloads++; } };
      sounds.push(sound);
      if (delayed && index === 0) await gate.promise;
      return { sound };
    } } },
    Platform: { OS: os }, FileSystem: { cacheDirectory: 'cache/', EncodingType: { Base64: 'base64' }, writeAsStringAsync: async () => {} },
    messages: [{ role: 'user', text: 'hello' }, { role: 'partner', text: 'reply' }],
    debrief: null, handledDebriefRef: { current: null }, increment() {}, analyzeDelivery() { return {}; }, language: 'en', practiceText: null,
    setDelivery() {}, setDifficulty() {}, persistSession() {}, user: null,
    finishBlocked: false, hangUpBlocked: false, requestDebrief() { scope.debrief = {}; },
    setStage(value) { scope.stage = value; }, transcriptBeforeUserTurn() { return []; }, restore() { scope.debrief = null; },
    pendingClipsRef: { current: [] }, autoFinishRef: { current: false }, lastSpokenIndex: { current: -1 }, redoFromRef: { current: null }, practicePartsRef: { current: [] },
    setPracticeParts() {}, setRedo() {}, setDraft() {}, setLineTrimmed() {}, setSecondsLeft() {}, setCurrentSpeaker() {}, reset() { scope.debrief = null; },
    WARMUP_SECONDS: 90, familyActive: false, setSession() {}, setTemperament() {},
    answeringRef: { current: false }, setPersona() {}, setSessionEventId() {}, setRoll() {}, setDeclined() {}, params: {}, pinnedParam() { return null; }, pickRandom() {}, TEMPERAMENTS: [], PRESETS: [],
  };
  const context = vm.createContext(scope);
  const run = code => vm.runInContext(ts.transpile(code, { target: ts.ScriptTarget.ES2022 }), context);
  const render = () => {
    cursor = 0;
    const api = run(`(() => { ${audioCode}\n${handlers}\n${debriefEffect}\nreturn { playAudio, handleFinish: ${kind === 'live' ? 'handleFinish' : 'handleHangUp'}, handleRedo, handleAgain${kind === 'live' ? ', handleChangeDifficulty' : ''} }; })()`);
    pendingEffects.splice(0).forEach(fn => fn());
    return api;
  };
  return { render, scope, sounds, gate };
}
for (const kind of ['live', 'incoming']) for (const os of ['web', 'ios']) {
  for (const delayed of [true, false]) test(`${kind}/${os}: debrief ${delayed ? 'invalidates delayed create' : 'unloads playing clip'}`, async () => {
    const s = screen(kind, os, delayed), api = s.render();
    const playback = api.playAudio('old'); await settle();
    api.handleFinish(); s.render(); s.render(); await settle();
    assert.equal(s.scope.stage, 'debrief');
    s.gate.resolve(); await playback;
    assert.equal(s.sounds[0].plays, delayed ? 0 : 1);
    assert.equal(s.sounds[0].unloads, 1);
    await api.playAudio('not eligible');
    assert.equal(s.sounds.length, 1, 'retained callback cannot create audio during debrief');
  });
  test(`${kind}/${os}: stage eligibility alone tears down playback`, async () => {
    const s = screen(kind, os, false), api = s.render();
    await api.playAudio('playing');
    s.scope.stage = kind === 'live' ? 'setup' : 'ring';
    s.render(); await settle();
    assert.equal(s.sounds[0].unloads, 1);
    await api.playAudio('blocked');
    assert.equal(s.sounds.length, 1);
  });
  for (const delayed of [true, false]) for (const transition of ['handleRedo', 'handleAgain', ...(kind === 'live' ? ['handleChangeDifficulty'] : [])]) test(`${kind}/${os}: ${transition} invalidates ${delayed ? 'pending' : 'playing'} audio; fresh audio works`, async () => {
    const s = screen(kind, os, delayed), api = s.render();
    const old = api.playAudio('old'); await settle();
    // Exercise reset/rewind independently of the debrief cleanup: session
    // invalidation must also protect a same-stage restart or batched transition.
    api[transition](0, 'redo'); s.render();
    if (transition === 'handleAgain') { s.scope.stage = kind === 'live' ? 'chat' : 'call'; s.render(); }
    s.gate.resolve(); await old;
    assert.equal(s.sounds[0].plays, delayed ? 0 : 1);
    assert.equal(s.sounds[0].unloads, 1);
    await s.render().playAudio('new');
    assert.equal(s.sounds[1].plays, 1);
    assert.equal(s.sounds[1].unloads, 0);
  });
}
