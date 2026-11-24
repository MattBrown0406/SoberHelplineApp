import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RECOVERY_PHASES } from '../src/lib/recoveryPathway';
import { FOR_NOW_MAX, PHASE_TOOLS, TOOL_IDS, toolsForPhase } from '../src/lib/toolsForPhase';
import {
  FLOW_ROUTES,
  FLOW_STEPS,
  flowStepNumber,
  invitationFlowState,
} from '../src/components/invitation/invitationFlow';

const read = (path: string) => readFileSync(path, 'utf8');
const locale = (lang: string, ns: string) => JSON.parse(read(`src/locales/${lang}/${ns}.json`));

// ── toolsForPhase: the pure picker ───────────────────────────────────────────

test('every phase and band keeps every tool reachable, exactly once', () => {
  for (const phase of [...RECOVERY_PHASES, null, undefined]) {
    for (const band of ['calm', 'watch', 'elevated', 'crisis', null] as const) {
      const { forNow, others } = toolsForPhase(phase, band);
      assert.ok(forNow.length >= 2 && forNow.length <= FOR_NOW_MAX, `${phase} ${band}: ${forNow}`);
      assert.deepEqual([...forNow, ...others].sort(), [...TOOL_IDS].sort(), `${phase} ${band}`);
      // "All tools" keeps the tab's usual order.
      assert.deepEqual(others, TOOL_IDS.filter((tool) => others.includes(tool)));
    }
  }
});

test('the phases pick the tools that fit', () => {
  assert.deepEqual(toolsForPhase('active_use', 'calm').forNow, ['invitation', 'safety', 'costs']);
  assert.deepEqual(toolsForPhase('unsure', 'calm').forNow, ['invitation', 'safety', 'costs']);
  assert.deepEqual(toolsForPhase('considering_treatment', 'calm').forNow, ['choose', 'actionPlan', 'invitation']);
  assert.deepEqual(toolsForPhase('in_treatment', 'calm').forNow, ['visitation', 'holiday', 'actionPlan']);
  assert.deepEqual(toolsForPhase('returning_home', 'calm').forNow, ['homecoming', 'holiday', 'safety']);
  assert.deepEqual(toolsForPhase('early_recovery_30', 'watch').forNow, ['homecoming', 'holiday', 'safety']);
  assert.deepEqual(toolsForPhase('early_recovery_90', 'calm').forNow, ['holiday', 'homecoming']);
  assert.deepEqual(toolsForPhase('ongoing_recovery', null).forNow, ['holiday', 'homecoming']);
  assert.deepEqual(toolsForPhase('return_to_use', 'calm').forNow, ['safety', 'invitation']);
  // Specialised tools stay under "All tools" for every phase.
  for (const phase of RECOVERY_PHASES) {
    assert.ok(!PHASE_TOOLS[phase].includes('diy'), phase);
    assert.ok(!PHASE_TOOLS[phase].includes('prosecutor'), phase);
  }
});

test('no phase known: the usual first three', () => {
  assert.deepEqual(toolsForPhase(null, 'calm').forNow, ['invitation', 'actionPlan', 'diy']);
  assert.deepEqual(toolsForPhase(undefined, null).forNow, TOOL_IDS.slice(0, 3));
});

test('an elevated or crisis band puts the Safety Wallet first, keeping at most three', () => {
  for (const band of ['elevated', 'crisis'] as const) {
    for (const phase of [...RECOVERY_PHASES, null]) {
      const { forNow } = toolsForPhase(phase, band);
      assert.equal(forNow[0], 'safety', `${phase} ${band}`);
      assert.equal(new Set(forNow).size, forNow.length);
    }
    assert.deepEqual(toolsForPhase('active_use', band).forNow, ['safety', 'invitation', 'costs']);
    assert.deepEqual(toolsForPhase('in_treatment', band).forNow, ['safety', 'visitation', 'holiday']);
    assert.deepEqual(toolsForPhase('ongoing_recovery', band).forNow, ['safety', 'holiday', 'homecoming']);
  }
  // Calm and watch leave the phase's order alone.
  assert.deepEqual(toolsForPhase('in_treatment', 'watch').forNow, ['visitation', 'holiday', 'actionPlan']);
});

// ── The Tools tab ────────────────────────────────────────────────────────────

test('Tools: picks for where she is, the rest one tap away', () => {
  const tools = read('app/(tabs)/learn.tsx');
  assert.match(tools, /const \{ lovedOne, loading: lovedOneLoading \} = useLovedOne\(user\?\.id \?\? null\);/);
  assert.match(tools, /const phase = lovedOne\?\.stage \? normalizeRecoveryPhase\(lovedOne\.stage, lovedOne\.status\) : null;/);
  assert.match(tools, /toolsForPhase\(phase, situationLoaded \? situation\.band : null\)/);
  // Only once the record has loaded, so the picks never jump.
  assert.match(tools, /const showForNow = !lovedOneLoading;/);
  assert.match(tools, /const allTools: readonly ToolId\[\] = showForNow \? others : TOOL_IDS;/);
  assert.match(tools, /\{showForNow && \(\s*<>[\s\S]*?\{forNow\.map\(\(tool\) => toolCards\[tool\]\)\}/);
  // "All tools" starts closed, through Today's disclosure (imported, not copied).
  assert.match(tools, /import \{ TodayDisclosure \} from '..\/..\/src\/components\/today\/TodayDisclosure';/);
  assert.match(tools, /<TodayDisclosure title=\{t\('tools\.allTitle'\)\}>\s*\{allTools\.map\(\(tool\) => toolCards\[tool\]\)\}/);
  // Every tool has its one card.
  const cards = tools.slice(tools.indexOf('const toolCards'), tools.indexOf('return (\n    <ScreenContainer'));
  for (const id of TOOL_IDS) assert.match(cards, new RegExp(`\\n    ${id}: \\(\\n      <View key="${id}"`), id);
  // The FAQ starts closed too.
  assert.match(tools, /<TodayDisclosure title=\{t\('faq\.eyebrow'\)\}>/);
  // The Boundaries destination opens Practice on its Boundaries part.
  assert.match(tools, /\['boundaries', '\/\(tabs\)\/scripts\?section=boundaries'\]/);
  for (const lang of ['en', 'es']) {
    const learn = locale(lang, 'learn');
    for (const key of ['forNowEyebrow', 'forNowBody', 'allTitle']) assert.ok(learn.tools[key], `${lang} ${key}`);
    assert.equal(learn.tools.eyebrow, undefined, `${lang}: the old eyebrow is gone`);
  }
});

// ── The invitation flow ──────────────────────────────────────────────────────

test('the invitation flow: four steps, where she is, and nothing on the safety-first path', () => {
  assert.deepEqual([...FLOW_STEPS], ['setup', 'kit', 'outcome', 'progress']);
  assert.deepEqual(FLOW_STEPS.map(flowStepNumber), [1, 2, 3, 4]);
  for (const step of FLOW_STEPS) assert.ok(read(`app${FLOW_ROUTES[step]}.tsx`), step);
  assert.equal(invitationFlowState({ stage: 'safety', hasAttempt: true, paused: false }), null);
  assert.deepEqual(invitationFlowState({ stage: 'map', hasAttempt: false, paused: false }), { current: 'setup', done: [], open: ['setup'] });
  assert.deepEqual(invitationFlowState({ stage: 'finishSetup', hasAttempt: false, paused: false })?.current, 'setup');
  // Without membership only the map opens; the paid steps stay shut.
  assert.deepEqual(invitationFlowState({ stage: 'paywall', hasAttempt: false, paused: false }), { current: null, done: ['setup'], open: ['setup'] });
  assert.deepEqual(invitationFlowState({ stage: 'active', hasAttempt: false, paused: false }), { current: 'kit', done: ['setup'], open: [...FLOW_STEPS] });
  assert.deepEqual(invitationFlowState({ stage: 'active', hasAttempt: true, paused: false }), { current: 'progress', done: ['setup', 'kit', 'outcome'], open: [...FLOW_STEPS] });
  // Paused (in treatment, after a yes, back home): no kit, as the engine hides Prepare.
  assert.deepEqual(invitationFlowState({ stage: 'active', hasAttempt: false, paused: true }), { current: 'progress', done: ['setup'], open: ['setup', 'outcome', 'progress'] });
  assert.ok(!invitationFlowState({ stage: 'active', hasAttempt: true, paused: true })?.open.includes('kit'));
});

test('the engine shows the steps; every step screen says its step and is counted as opened', () => {
  const engine = read('app/invitation-engine.tsx');
  assert.match(engine, /invitationFlowState\(\{ stage, hasAttempt: !!snapshot\.lastAttempt, paused: !!forecast\?\.paused \}\)/);
  assert.match(engine, /\{flow && <FlowStepList state=\{flow\} \/>\}/);
  for (const [step, file] of [['setup', 'invitation-setup'], ['kit', 'invitation-kit'], ['outcome', 'invitation-outcome'], ['progress', 'invitation-progress']] as const) {
    const source = read(`app/${file}.tsx`);
    assert.match(source, new RegExp(`<FlowStepLine step="${step}" />`), file);
    assert.match(source, new RegExp(`useToolOpened\\('invitation_${step}'\\)`), file);
  }
  // Kit, outcome and progress go back to the engine (setup keeps its own save-then-leave).
  for (const file of ['invitation-kit', 'invitation-outcome', 'invitation-progress']) {
    const source = read(`app/${file}.tsx`);
    assert.match(source, /<EngineBackLink \/>/, file);
    assert.doesNotMatch(source, /<BackLink /, file);
  }
  assert.match(read('src/components/invitation/FlowSteps.tsx'), /router\.dismissTo\('\/invitation-engine' as never\)/);
  for (const lang of ['en', 'es']) {
    const invitation = locale(lang, 'invitation');
    for (const step of FLOW_STEPS) assert.ok(invitation.flow.steps[step], `${lang} ${step}`);
    for (const key of ['title', 'stepOf', 'stepLine', 'current', 'done', 'back']) assert.ok(invitation.flow[key], `${lang} ${key}`);
    // The map's own questions are "questions", so they never read as a second "Step N".
    assert.match(invitation.setup.progress, lang === 'en' ? /^Question / : /^Pregunta /);
  }
});
