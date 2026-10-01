import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  engineForecastInput,
  engineStage,
  isSafetyFirst,
  localClock,
  parseEngineSnapshot,
} from '../src/lib/invitationEngine';
import { forecastReasonCopy, formatLocalDate, moveCopy } from '../src/lib/invitationCopy';
import { scoreReceptivity, SOBER_TIMES, type ForecastReason } from '../src/lib/invitationForecast';
import { INVITATION_MOVES } from '../src/lib/invitationMoves';

const en = JSON.parse(readFileSync('src/locales/en/invitation.json', 'utf8'));
const es = JSON.parse(readFileSync('src/locales/es/invitation.json', 'utf8'));

function at(path: string, locale: Record<string, unknown>): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined), locale);
}

/** i18next plural keys: "x" resolves via x_one / x_other when a count is passed. */
function hasKey(path: string, locale: Record<string, unknown>, plural = false): boolean {
  if (typeof at(path, locale) === 'string') return true;
  return plural && typeof at(`${path}_one`, locale) === 'string' && typeof at(`${path}_other`, locale) === 'string';
}

const RAW = {
  local_date: '2026-10-02',
  has_access: true,
  profile: { saved: true, completed: true, safety_concern: 'none' },
  state: { setup_completed_at: '2026-09-20T10:00:00Z', window_push_opt_in: true, last_window_push_at: null },
  plan: {
    scope: 'family',
    seed: 'space-1',
    members: 3,
    // A stray family-level flag must be ignored: safety is per member.
    signals: { sober_moments: true, triggers: false, costs: true, phrases: false, sober_times: ['evening', 'bogus'], safety_serious: true },
  },
  safety_first: false,
  loved_one_status: 'using',
  loved_one_stage: 'considering_treatment',
  recovery_phase: 'considering_treatment',
  outcome_gate: { outcome: 'not_yet', local_date: '2026-09-29', next_window_date: '2026-10-02' },
  today: { moves_done: ['i_statement', 3], check: 'calm', forecast: { level: 'possible', score: 50 } },
  inputs: {
    latest_consequence_at: '2026-10-02T12:00:00Z',
    warning_this_week: 1, warning_last_week: 3, recovery_this_week: 2, recovery_last_week: 0, move_days_7: 4,
  },
  last_attempt: { outcome: 'not_yet', local_date: '2026-09-29', created_at: '2026-09-29T20:00:00Z', next_window_date: '2026-10-02' },
};

test('the engine snapshot is parsed into a typed shape', () => {
  const snapshot = parseEngineSnapshot(RAW);
  assert.ok(snapshot);
  assert.equal(snapshot.plan.scope, 'family');
  assert.deepEqual(snapshot.plan.soberTimes, ['evening']);
  assert.deepEqual(snapshot.today.movesDone, ['i_statement']);
  assert.equal(snapshot.today.check, 'calm');
  assert.equal(snapshot.lastAttempt?.outcome, 'not_yet');
  assert.equal(snapshot.safetyFirst, false);
  assert.equal(snapshot.plan.signals.safetySerious, false, 'a family-level flag never reaches this member');
  assert.equal(snapshot.recoveryPhase, 'considering_treatment');
  assert.deepEqual(snapshot.today.forecast, { level: 'possible', score: 50 });
  assert.equal(parseEngineSnapshot({ local_date: 'tomorrow' }), null);
  assert.equal(parseEngineSnapshot(null), null);
  const bare = parseEngineSnapshot({ local_date: '2026-10-02' });
  assert.ok(bare);
  assert.equal(bare.plan.scope, 'solo');
  assert.equal(bare.lastAttempt, null);
  assert.equal(bare.today.check, null);
  assert.equal(bare.safetyFirst, true, 'an unknown safety flag is treated as safety-first');
});

test('stages: map first, safety beats the paywall, then setup, then active', () => {
  const snapshot = parseEngineSnapshot(RAW)!;
  assert.equal(engineStage(snapshot, true), 'active');
  assert.equal(engineStage(snapshot, false), 'paywall');
  assert.equal(engineStage({ ...snapshot, state: { ...snapshot.state, setupCompletedAt: null } }, true), 'finishSetup');
  assert.equal(engineStage({ ...snapshot, profile: { ...snapshot.profile, completed: false } }, true), 'map');
  const ownSerious = { ...snapshot, safetyFirst: true };
  assert.equal(engineStage(ownSerious, false), 'safety');
  // Setup saves after the safety question: an unfinished map that already
  // says 'serious' is the safety path, never "Help them say yes".
  assert.equal(engineStage({ ...ownSerious, profile: { ...snapshot.profile, completed: false } }, true), 'safety');
  assert.equal(isSafetyFirst(ownSerious), true);
  assert.equal(isSafetyFirst(null), false, 'callers treat a missing snapshot as unknown and gate on it');
  assert.equal(engineStage({ ...snapshot, profile: { ...snapshot.profile, safetyConcern: 'serious' } }, true), 'safety');
});

test('the client forecast reads the same snapshot fields as the window push', () => {
  const snapshot = parseEngineSnapshot(RAW)!;
  const input = engineForecastInput(snapshot, { hour: 17, weekday: 5 }, Date.parse('2026-10-02T22:00:00Z'));
  assert.equal(input.moveDaysLast7, 4);
  assert.equal(input.todayCheck, 'calm');
  assert.equal(input.safetySerious, false);
  // Pauses read the family-level outcome gate, not only her own last log.
  assert.equal(input.lastOutcome, 'not_yet');
  assert.equal(input.lastOutcomeDate, '2026-09-29');
  assert.equal(input.nextWindowDate, '2026-10-02');
  assert.equal(input.recoveryPhase, 'considering_treatment');
  const familyYes = engineForecastInput({ ...snapshot, outcomeGate: { outcome: 'yes', localDate: '2026-09-30', nextWindowDate: null } }, { hour: 17, weekday: 5 }, Date.parse('2026-10-02T22:00:00Z'));
  assert.equal(scoreReceptivity(familyYes).paused, 'after_yes', 'a yes logged by Dad pauses Mom');
  const coming = engineForecastInput({ ...snapshot, recoveryPhase: 'returning_home' }, { hour: 17, weekday: 5 }, Date.parse('2026-10-02T22:00:00Z'));
  assert.equal(scoreReceptivity(coming).paused, 'returning_home');
  assert.equal(scoreReceptivity(input).level, 'good', 'the suggested window day itself is open');
  const resting = engineForecastInput({ ...snapshot, localDate: '2026-10-01' }, { hour: 17, weekday: 4 }, Date.parse('2026-10-01T22:00:00Z'));
  assert.equal(scoreReceptivity(resting).level, 'low', 'before the next window the forecast rests');
  const treatment = engineForecastInput({ ...snapshot, recoveryPhase: 'in_treatment' }, { hour: 17, weekday: 5 }, Date.parse('2026-10-02T22:00:00Z'));
  assert.equal(scoreReceptivity(treatment).paused, 'in_treatment');
});

test('local clock follows the account timezone', () => {
  const now = new Date('2026-10-03T02:30:00Z');
  assert.deepEqual(localClock(now, 'America/Los_Angeles'), { date: '2026-10-02', hour: 19, weekday: 5 });
  assert.deepEqual(localClock(now, 'UTC'), { date: '2026-10-03', hour: 2, weekday: 6 });
  const fallback = localClock(now, 'Not/AZone');
  assert.match(fallback.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('every forecast reason the scorer can produce has EN and ES copy', () => {
  const reasons: ForecastReason[] = [
    { code: 'safetyHold', effect: 'down' },
    { code: 'consequenceWindow', effect: 'up', params: { hours: 1 } },
    { code: 'trendImproving', effect: 'up' },
    { code: 'trendWorsening', effect: 'down' },
    { code: 'soberTimeUnknown', effect: 'neutral' },
    { code: 'consistent', effect: 'up', params: { days: 5 } },
    { code: 'buildingConsistency', effect: 'up', params: { days: 2 } },
    { code: 'noMovesYet', effect: 'neutral' },
    { code: 'calmToday', effect: 'up' },
    { code: 'okayToday', effect: 'up' },
    { code: 'roughToday', effect: 'down' },
    { code: 'noCheckToday', effect: 'neutral' },
    { code: 'restingUntil', effect: 'down', params: { days: 3 } },
    { code: 'inTreatment', effect: 'neutral' },
    { code: 'returningHome', effect: 'neutral' },
    { code: 'inRecovery', effect: 'neutral' },
    { code: 'afterYes', effect: 'neutral' },
    ...(['soberTimeNow', 'soberTimeLater', 'soberTimeOther'] as const).flatMap((code) =>
      SOBER_TIMES.map((period) => ({ code, effect: 'up' as const, params: { period } }))),
  ];
  for (const reason of reasons) {
    const copy = forecastReasonCopy(reason);
    const plural = copy.params?.count !== undefined;
    assert.ok(hasKey(copy.key, en, plural), `en ${copy.key}`);
    assert.ok(hasKey(copy.key, es, plural), `es ${copy.key}`);
  }
  for (const level of ['low', 'possible', 'good']) {
    assert.ok(at(`forecast.level.${level}`, en) && at(`forecast.level.${level}`, es));
    assert.ok(at(`forecast.levelBody.${level}`, en) && at(`forecast.levelBody.${level}`, es));
  }
  for (const move of INVITATION_MOVES) {
    for (const key of Object.values(moveCopy(move))) assert.ok(hasKey(key, en) && hasKey(key, es), key);
  }
});

test('dates are formatted in the app language', () => {
  assert.match(formatLocalDate('2026-10-03', 'en'), /Oct/);
  assert.match(formatLocalDate('2026-10-03', 'es-MX'), /oct/i);
  assert.equal(formatLocalDate('junk', 'en'), 'junk');
});

// ── Static contract checks over the engine's own files ────────────────────────

const ENGINE_FILES = [
  'app/invitation-engine.tsx',
  'app/invitation-setup.tsx',
  'app/invitation-kit.tsx',
  'app/invitation-outcome.tsx',
  'app/invitation-progress.tsx',
  ...readdirSync('src/components/invitation').map((name) => join('src/components/invitation', name)),
];

test('every literal invitation key used by the engine screens exists in EN and ES', () => {
  for (const file of ENGINE_FILES) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bt\('([a-zA-Z][\w.]*)'/g)) {
      const key = match[1];
      if (key.includes(':')) continue;
      const plural = new RegExp(`t\\('${key.replace(/\./g, '\\.')}',\\s*\\{[^}]*count`).test(source);
      assert.ok(hasKey(key, en, plural), `${file}: en ${key}`);
      assert.ok(hasKey(key, es, plural), `${file}: es ${key}`);
    }
  }
});

test('engine screens use appAlert-free flows, Gate the paid routes and never hardcode copy switches', () => {
  for (const file of ENGINE_FILES) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /Alert\.alert/, file);
    assert.doesNotMatch(source, /isSpanish\s*\?/, file);
  }
  for (const file of ['app/invitation-kit.tsx', 'app/invitation-outcome.tsx', 'app/invitation-progress.tsx']) {
    assert.match(readFileSync(file, 'utf8'), /<Gate feature="invitationEngine">/, file);
  }
});

test('the kit links into conversation practice with the agreed params', () => {
  const kit = readFileSync('app/invitation-kit.tsx', 'utf8');
  assert.match(kit, /pathname: '\/rehearsal-live', params: \{ practiceText, source: 'invitation' \}/);
  // The multi-line kit travels through the in-memory handoff, not the URL.
  assert.match(kit, /stashPracticeText\(practiceText, 'invitation', accountId\)/);
  assert.match(kit, /pathname: '\/rehearsal-live', params: \{ handoff, source: 'invitation' \}/);
  assert.match(kit, /practiceNeedsHandoff\(practiceText\)/);
  assert.match(kit, /pathname: '\/rehearsal-live', params: \{ warmup: '1', source: 'invitation' \}/);
  assert.match(kit, /router\.push\('\/finder'/);
});

test('a logged yes opens They Said Yes mode; the plan screen honours focus=yes', () => {
  const outcome = readFileSync('app/invitation-outcome.tsx', 'utf8');
  assert.match(outcome, /pathname: '\/treatment-action-plan',\s*\/\/[^\n]*\n\s*params: \{ focus: 'yes', source: 'invitation', alerted:/);
  const plan = readFileSync('app/treatment-action-plan.tsx', 'utf8');
  assert.match(plan, /params\.focus === 'yes'/);
  assert.match(plan, /\{focusYes && yesMode\}/);
  assert.match(plan, /\{!focusYes && yesMode\}/);
  assert.doesNotMatch(plan, /Alert\.alert/);
});

test('Today shows the engine card on both tiers, after check-in and before events', () => {
  const today = readFileSync('app/(tabs)/index.tsx', 'utf8');
  const screens = today.split('<ScreenContainer').slice(1);
  assert.equal(screens.length, 2);
  for (const screen of screens) {
    assert.ok(screen.includes('{invitationCard}'));
    assert.ok(screen.indexOf('{checkInCard}') < screen.indexOf('{invitationCard}'));
    assert.ok(screen.indexOf('{invitationCard}') < screen.indexOf('<SituationCard'));
  }
});

test('setup never builds a draft over a map it failed to load (review regression)', () => {
  const setup = readFileSync('app/invitation-setup.tsx', 'utf8');
  // The map is loaded with an explicit error state, not the hook that treats a failure as "no map".
  assert.doesNotMatch(setup, /useLovedOneProfile\(/);
  assert.match(setup, /if \(saved\.state === 'error'\)/);
  assert.match(setup, /saved\.state !== 'ready'/);
  assert.match(setup, /setup\.loadErrorTitle/);
  // Finishing requires a safety answer.
  assert.match(setup, /if \(!current\.safetyConcern\)/);
  for (const locale of [en, es]) assert.ok(at('setup.loadErrorTitle', locale) && at('setup.loadErrorBody', locale));
});

test('the kit shows no lines or rehearse buttons until safety status is known (review regression)', () => {
  const kit = readFileSync('app/invitation-kit.tsx', 'utf8');
  const gate = kit.indexOf('if (!engine.snapshot)');
  const safety = kit.indexOf('if (isSafetyFirst(engine.snapshot))');
  const lines = kit.indexOf("t('kit.linesTitle')");
  assert.ok(gate > 0 && safety > gate && lines > safety, 'unknown → loading/error, then safety-first, then lines');
});

test('the outcome screen logs the day of the ask, with the live forecast only as a same-day fallback', () => {
  const outcome = readFileSync('app/invitation-outcome.tsx', 'utf8');
  assert.match(outcome, /askDate\(today, askedOn\)/);
  assert.match(outcome, /forecast: askedOn === 'today' \? engine\.forecast : null/);
});

test('safety is per member: no family-level safety copy or prop remains (audit regression)', () => {
  for (const locale of [en, es]) assert.equal(at('safety.familyBody', locale), undefined);
  for (const file of [...ENGINE_FILES, 'src/components/today/WillingnessWindowAlert.tsx', 'src/components/tracker/WillingnessWindowCard.tsx']) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /flaggedByFamily|familyBody|plan\.signals\.safetySerious/, file);
  }
  const setup = readFileSync('app/invitation-setup.tsx', 'utf8');
  assert.match(setup, /setup\.safety\.seriousNote/);
  for (const locale of [en, es]) assert.ok(at('setup.safety.seriousNote', locale));
  assert.match(String(at('setup.privacy', en)), /never see your answers/);
});

test('the willingness window never invites unless her answer is freshly known to be non-serious (audit regressions)', () => {
  const alert = readFileSync('src/components/today/WillingnessWindowAlert.tsx', 'utf8');
  assert.match(alert, /useInvitationSafety\(accountId\)/);
  assert.doesNotMatch(alert, /useLovedOneProfile/);
  const gateAt = alert.indexOf("if (safety.gate === 'loading') return null;");
  assert.ok(gateAt > 0 && gateAt < alert.indexOf('window.sayLabel'));
  assert.match(alert, /safety\.gate === 'safety_first'\) return <WindowSafetyNotice \/>/);
  assert.match(alert, /safety\.gate === 'unknown'\) return <WindowSafetyNotice unknown/);
  const card = readFileSync('src/components/tracker/WillingnessWindowCard.tsx', 'utf8');
  const active = card.slice(card.indexOf('{activeEvent ? ('), card.indexOf('<View style={styles.linkRow}>'));
  assert.ok(active.indexOf('{inviteAllowed && (') < active.indexOf('window.openTitle'), 'headline gated');
  assert.ok(active.indexOf('!inviteAllowed ? null') < active.indexOf('window.sayLabel'), 'say box gated');
  assert.match(active, /<WindowSafetyNotice unknown/);
  const hook = readFileSync('src/hooks/useInvitationSafety.ts', 'utf8');
  assert.match(hook, /useFocusEffect/);
});

test('paused states replace the forecast and the invite prompt (audit regression)', () => {
  const engine = readFileSync('app/invitation-engine.tsx', 'utf8');
  assert.match(engine, /forecast\.paused \? \(\s*<PausedCard/);
  for (const reason of ['returning_home', 'in_recovery']) {
    for (const locale of [en, es]) assert.ok(at(`paused.${reason}.title`, locale) && at(`paused.${reason}.body`, locale), reason);
  }
  assert.match(engine, /!forecast\.paused && forecast\.level === 'good'/);
  assert.match(engine, /!forecast\.paused && forecast\.level !== 'good'/);
  const today = readFileSync('src/components/invitation/InvitationTodayCard.tsx', 'utf8');
  assert.match(today, /if \(forecast\?\.paused\)/);
  for (const reason of ['in_treatment', 'after_yes']) {
    for (const locale of [en, es]) assert.ok(at(`paused.${reason}.title`, locale) && at(`paused.${reason}.body`, locale));
  }
});

test('lower-severity audit fixes stay in place', () => {
  const engine = readFileSync('app/invitation-engine.tsx', 'utf8');
  assert.match(engine, /disabled=\{engine\.pushSaving \|\| alertsPending\}/);
  assert.match(engine, /if \(alertsPending\) return;/);
  for (const file of ['app/invitation-setup.tsx', 'app/invitation-outcome.tsx']) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /router\.replace\('\/invitation-engine'/, file);
    assert.match(source, /router\.dismissTo\('\/invitation-engine'/, file);
  }
  const outcome = readFileSync('app/invitation-outcome.tsx', 'utf8');
  assert.match(outcome, /alerted: saved\.coachAlerted \? '1' : '0'/);
  const plan = readFileSync('app/treatment-action-plan.tsx', 'utf8');
  assert.match(plan, /coachAlerted\s*\?\s*t\('outcome\.yesBodyAlerted'\)\s*:\s*t\('outcome\.yesBody'\)/);
  for (const locale of [en, es]) {
    assert.doesNotMatch(String(at('outcome.yesBody', locale)), /notified|avis/i, 'no claim Matt was alerted');
    assert.doesNotMatch(String(at('outcome.yesBodyAlerted', locale)), /\b(hours?|horas?|minutes?|minutos?)\b/i, 'never promise a time');
  }
  const hook = readFileSync('src/hooks/useInvitationEngine.ts', 'utf8');
  assert.match(hook, /if \(rank <= best\) return;/);
  assert.match(hook, /const sentForecastRank = new Map/);
});

test('the kit screens what she typed before any line or rehearse button (audit round 2)', () => {
  const kit = readFileSync('app/invitation-kit.tsx', 'utf8');
  // Same combined check as the coach, over every free-text field it would see.
  assert.match(kit, /kitCrisisState\(screenInput, serverCrisis, acknowledgement\?\.key \?\? null\)/);
  assert.match(kit, /const screenInput = useMemo\(\(\) => \(\{/);
  for (const field of ['observation', 'next_step: program', 'recent_incidents', 'usual_phrases', 'costs_they_feel', 'what_use_gives', 'sober_moments', 'use_triggers']) {
    assert.ok(kit.includes(field), field);
  }
  assert.match(kit, /result\.code === 'crisis'/);
  // Every server hit (patterns or moderation) is a new hit with its own id.
  assert.match(kit, /field: result\.field \?\? 'unknown',\s*source: result\.source === 'moderation' \? 'moderation' : 'patterns',\s*id: serverHits\.current,/);
  // Editing the observation clears a server hit (either source) that was in the observation.
  assert.match(kit, /setServerCrisis\(afterObservationEdit\)/);
  assert.match(kit, /\{!crisis && LINE_STYLES\.map/);
  // "I'm safe right now" — offered for every hit (patterns or moderation); per visit, per hit; sent to the server.
  assert.match(kit, /onAcknowledge=\{acknowledgeSafe\}/);
  assert.doesNotMatch(kit, /moderationCrisis/);
  // Her acknowledgement records the observation and next step on screen; the
  // server still screens either one if it changed since (audit round 7).
  assert.match(kit, /setAcknowledgement\(\{ key: crisisKey, observation, nextStep: program \}\)/);
  assert.match(kit, /acknowledgedCrisis: acknowledged,/);
  assert.match(kit, /acknowledgedObservation: acknowledged \? acknowledgement\?\.observation : undefined,/);
  assert.match(kit, /acknowledgedNextStep: acknowledged \? acknowledgement\?\.nextStep : undefined,/);
  const api = readFileSync('src/lib/invitationApi.ts', 'utf8');
  assert.match(api, /acknowledgedObservation: input\.acknowledgedCrisis === true \? input\.acknowledgedObservation \?\? '' : '',/);
  // Back from "Edit your map": re-read the map, forget server hits and the acknowledgement.
  const focus = kit.slice(kit.indexOf('useFocusEffect('), kit.indexOf('[reloadProfile]'));
  assert.match(focus, /reloadProfile\(\)/);
  assert.match(focus, /setServerCrisis\(null\)/);
  assert.match(focus, /setAcknowledgement\(null\)/);
  const coach = readFileSync('supabase/functions/invitation-coach/index.ts', 'utf8');
  // One gate (patterns, then moderation; her acknowledgement sets aside either —
  // behavior pinned in _shared/invitation-moderation_test.ts), before any quota or model call.
  const screen = coach.indexOf("json(409, { ok: false, code: 'crisis', field: crisis.field, source: crisis.source })");
  const gate = coach.indexOf('await invitationCrisisGate({');
  assert.ok(gate > 0 && screen > gate && screen < coach.indexOf("rpc('consume_rehearsal_quota'"), 'screened before quota');
  assert.ok(screen < coach.indexOf("Deno.env.get('ANTHROPIC_API_KEY')", gate), 'screened before the AI-key check');
  assert.match(coach, /userInCrisis/);
  // Her acknowledgement narrows the screen to what she typed since (pinned in
  // _shared/invitation-moderation_test.ts), never skips it wholesale.
  assert.match(coach, /const screen = fieldsToScreen\(SCREENED_FIELDS, request\.acknowledgedCrisis, \[/);
  assert.match(coach, /\{ field: 'observation', current: request\.observation, acknowledgedText: request\.acknowledgedObservation \}/);
  assert.match(coach, /\{ field: 'next_step', current: request\.nextStep, acknowledgedText: request\.acknowledgedNextStep \}/);
  assert.ok(coach.indexOf('const screen = fieldsToScreen(') < gate, 'scope decided before the gate');
  assert.match(coach, /Object\.fromEntries\(fields\.map\(\(field\) => \[field, screenedFields\[field\]\]\)\)/);
  assert.match(coach, /\(text\) => invitationTextInCrisis\(text\) \|\| userInCrisis\(text\)/);
  assert.match(coach, /moderate: \(texts\) => moderateInvitationTexts\(texts, Deno\.env\.get\('OPENAI_API_KEY'\)\)/);
  for (const column of ['use_triggers', 'what_use_gives', 'costs_they_feel', 'sober_moments', 'usual_phrases', 'recent_incidents']) {
    assert.match(coach, new RegExp(`${column}: list\\(profileRow\\.${column}\\)`), column);
  }
  assert.match(coach, /next_step: request\.nextStep/);
  for (const locale of [en, es]) {
    assert.match(String(at('crisis.danger', locale)), /911/);
    assert.match(String(at('crisis.danger', locale)), /988/);
  }
});

test('a safety answer is saved the moment she picks it, through one ordered save queue (audit round 3)', async () => {
  const setup = readFileSync('app/invitation-setup.tsx', 'utf8');
  assert.match(setup, /onPress=\{\(\) => chooseSafety\(concern\)\}/);
  const choose = setup.slice(setup.indexOf('function chooseSafety'), setup.indexOf('function leaveSetup'));
  assert.match(choose, /void enqueueSave\(next, false\)/);
  assert.match(setup, /return saveQueue\.current!\(async \(\) =>/);
  assert.match(setup, /const ok = await enqueueSave\(profile, complete\)/);
  assert.match(setup, /onPress=\{\(\) => \{ void leaveSetup\(\); \}\}/);
  // The queue keeps call order even when an earlier save is slower.
  const { createSerialQueue } = await import('../src/lib/invitationSetup');
  const enqueue = createSerialQueue();
  const order: string[] = [];
  const slow = enqueue(async () => { await new Promise((r) => setTimeout(r, 20)); order.push('safety'); return 1; });
  const failing = enqueue(async () => { order.push('broken'); throw new Error('offline'); });
  const fast = enqueue(async () => { order.push('next'); return 2; });
  await Promise.allSettled([slow, failing, fast]);
  assert.deepEqual(order, ['safety', 'broken', 'next'], 'serialized, and a failure does not stop later saves');
  assert.equal(await fast, 2);
});

test('leaving setup waits (briefly) for her edits, pops only itself, and never desyncs native back (audit rounds 4-5)', async () => {
  const setup = readFileSync('app/invitation-setup.tsx', 'utf8');
  const leave = setup.slice(setup.indexOf('async function leaveSetup'), setup.indexOf('const leaveRef'));
  assert.match(leave, /if \(leaving\.current\) return;/);
  assert.match(leave, /setLeavingBusy\(true\)/);
  assert.match(leave, /await settleWithin\(flushPending\(\), LEAVE_SAVE_TIMEOUT_MS\);/);
  // Typed-but-not-Added words are folded into this step's list before the save.
  assert.ok(leave.indexOf('commitPending();') > 0 && leave.indexOf('commitPending();') < leave.indexOf('flushPending()'));
  // Source-bound and focus-checked: a back press during the wait can't pop the kit too.
  assert.match(leave, /if \(navigation\.isFocused\(\)\) navigation\.goBack\(\);/);
  // Re-armed in a finally: losing focus mid-save (no pop) never leaves Back dead.
  assert.match(leave, /\} finally \{\s*(?:\/\/[^\n]*\n\s*)*leaving\.current = false;/);
  assert.doesNotMatch(leave, /router\.back\(\)/);
  // No raw beforeRemove preventDefault (unsupported for native-stack's iOS swipe):
  // the swipe is off for this screen and Android's back button goes through leaveSetup.
  assert.doesNotMatch(setup, /addListener\('beforeRemove'/);
  assert.match(setup, /<Stack\.Screen options=\{\{ gestureEnabled: false \}\} \/>/);
  const android = setup.slice(setup.indexOf("BackHandler.addEventListener('hardwareBackPress'"));
  assert.match(android, /if \(leaving\.current\) return true;/);
  assert.match(android, /if \(!dirty\.current && !pendingRef\.current\.trim\(\)\) return false;/);
  assert.match(android, /void leaveRef\.current\(\);\s*return true;/);
  assert.match(setup, /busy=\{leavingBusy\}/);
  // Finish paths aren't intercepted by anything.
  assert.match(setup, /router\.dismissTo\('\/invitation-engine'/);
  const { settleWithin, LEAVE_SAVE_TIMEOUT_MS } = await import('../src/lib/invitationSetup');
  assert.ok(LEAVE_SAVE_TIMEOUT_MS <= 3000, 'never holds navigation long');
  assert.equal(await settleWithin(Promise.resolve('saved'), 50), 'saved');
  assert.equal(await settleWithin(new Promise(() => undefined), 20), 'timeout', 'a slow network never blocks leaving');
  assert.equal(await settleWithin(Promise.reject(new Error('offline')), 50), 'timeout');
});

test('typed-but-not-Added words stay on their own step: committed on Next, Previous, Back and leaving (audit round 6)', async () => {
  const setup = readFileSync('app/invitation-setup.tsx', 'utf8');
  // A fresh picker per step, with the typed text lifted into setup.
  assert.match(setup, /<ChipPicker\s*(?:\/\/[^\n]*\n\s*)*key=\{step\}/);
  assert.match(setup, /draftText=\{pendingItem\}/);
  assert.match(setup, /onDraftChange=\{setPendingItem\}/);
  // Next: commit first, then save exactly that profile (never a stale render's draft).
  const next = setup.slice(setup.indexOf('async function next()'), setup.indexOf('async function finishWithAlerts'));
  assert.match(next, /const current = commitPending\(\) \?\? draft;/);
  assert.ok(next.indexOf('commitPending()') < next.indexOf('persist(current, false)'));
  assert.match(next, /persist\(current, true\)/);
  assert.doesNotMatch(next, /persist\((?:true|false)\)/);
  // Typed while Next's save was in flight: still this step's (audit round 7).
  const afterSave = next.slice(next.indexOf('await persist(current, false)'));
  assert.ok(afterSave.indexOf('commitPending();') > 0 && afterSave.indexOf('commitPending();') < afterSave.indexOf('setStepIndex('));
  assert.match(setup, /inputDisabled=\{saving \|\| leavingBusy\}/);
  // Previous: commit before changing step.
  const back = setup.slice(setup.indexOf('function back()'));
  assert.ok(back.indexOf('commitPending();') > 0 && back.indexOf('commitPending();') < back.indexOf('setStepIndex('));
  // The commit itself: into the CURRENT step's list.
  const commit = setup.slice(setup.indexOf('function commitPending()'), setup.indexOf('/** Queue one save'));
  assert.match(commit, /commitPendingItem\(current, STEP_FIELD\[step\], text, timesTouched\.current\)/);
  assert.match(commit, /draftRef\.current = next;/);

  const { commitPendingItem, withListItems } = await import('../src/lib/invitationSetup');
  const { emptyLovedOneProfile, PROFILE_LIST_LIMIT } = await import('../src/lib/lovedOneProfile');
  const base = { ...emptyLovedOneProfile(), useTriggers: ['Payday'] };
  // Typed on the triggers step → lands in triggers, nowhere else.
  const committed = commitPendingItem(base, 'useTriggers', '  Fights with his dad ', false);
  assert.deepEqual(committed?.useTriggers, ['Payday', 'Fights with his dad']);
  assert.deepEqual(committed?.whatUseGives, []);
  // Nothing to add: no list on this step, blank, duplicate, or a full list.
  assert.equal(commitPendingItem(base, undefined, 'words', false), null);
  assert.equal(commitPendingItem(base, 'useTriggers', '   ', false), null);
  assert.equal(commitPendingItem(base, 'useTriggers', 'payday', false), null);
  const full = { ...base, useTriggers: Array.from({ length: PROFILE_LIST_LIMIT }, (_, i) => `t${i}`) };
  assert.equal(commitPendingItem(full, 'useTriggers', 'one more', false), null);
  // Sober moments: the same sober-time prefill as tapping Add, unless she touched the times.
  const morning = commitPendingItem(base, 'soberMoments', 'Mornings before work', false);
  assert.ok((morning?.soberTimes ?? []).length > 0, 'prefilled from her words');
  assert.deepEqual(commitPendingItem(base, 'soberMoments', 'Mornings before work', true)?.soberTimes ?? [], base.soberTimes ?? []);
  assert.deepEqual(withListItems(base, 'usualPhrases', ['Leave me alone'], false).usualPhrases, ['Leave me alone']);
});
