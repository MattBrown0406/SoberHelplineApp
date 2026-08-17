import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import {
  addDiyTeamMember,
  defaultDiyInterventionPlan,
  diyFitResult,
  diyInterventionProgress,
  diySolutionKey,
  diyStageAccess,
  DIY_TEAM_ID_LIMIT,
  DIY_TEAM_LIMIT,
  DIY_TEAM_TEXT_LIMIT,
  updateDiyTeamMember,
  type DiyTapSnapshot,
} from '../src/lib/diyInterventionPlanner';
import {
  DIY_CURRENT_PROTECTED_PARTS, DIY_PROTECTED_PARTS,
  type DiyCurrentProtectedPart, type DiyProtectedPart,
} from '../src/lib/diyInterventionStorageKeys';
import {
  legacyDiyTeamExtraRecord, parseCurrentDiyProtectedParts,
  parseDiyProtectedParts, serializeDiyProtectedParts,
} from '../src/lib/diyInterventionProtectedRecord';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const TEST_NOW = new Date('2026-08-19T19:00:00.000Z');

function readyTap(overrides: Partial<DiyTapSnapshot> = {}): DiyTapSnapshot {
  return {
    hydrated: true,
    saveState: 'saved',
    logisticsReady: true,
    dayOfRecordingReady: true,
    programName: 'Named Treatment Program',
    admissionsContactName: 'Jordan Lee',
    admissionsPhone: '503-555-1212',
    bedConfirmedFor: '2026-08-20',
    bedConfirmationWindow: 'Arrive 4–6 PM',
    bedConfirmedBy: 'Jordan Lee',
    bedReconfirmedAt: '2026-08-19T18:00:00.000Z',
    departureAt: '2026-08-20T14:00:00.000Z',
    revision: '2026-08-19T18:00:00.000Z',
    logisticsFingerprint: '{"transport":"Morgan","backup":"Casey"}',
    ...overrides,
  };
}

function completePlan() {
  let plan = defaultDiyInterventionPlan();
  plan.fit = {
    recentViolence: 'no', weaponInHouse: 'no', activePsychosis: 'no', overdoseLastDay: 'no',
    childrenCannotExit: 'no', familyUnitedOnOneSolution: 'yes', canExecuteBasicsWithoutTutorial: 'yes',
  };
  plan.care = {
    indicatedLevel: 'residential', whyThisLevel: 'Daily use and repeated inability to stay safe outside structure.',
    acceptedPreferenceLevel: 'outpatient', planLevel: 'residential',
  };
  plan.interventionDate = '2026-08-20';
  plan = addDiyTeamMember(plan, { id: 'speaker-1', name: 'Alex', relationship: 'Parent', role: 'speaker' });
  plan = updateDiyTeamMember(plan, 'speaker-1', { activelyUsing: false, offersCompetingPlan: false, isChild: false, aligned: true });
  plan = addDiyTeamMember(plan, { id: 'support-1', name: 'Sam', relationship: 'Sibling', role: 'silent_support' });
  plan = updateDiyTeamMember(plan, 'support-1', { activelyUsing: false, offersCompetingPlan: false, isChild: false, aligned: true });
  plan.undercutter = { answer: 'named', memberId: 'support-1', agreesToSolutionAndLeaveTime: true };
  const solutionKey = diySolutionKey(plan, readyTap());
  plan.unity = {
    solutionConfirmed: true,
    solutionKey,
    yesPlan: 'Leave once for the named program with the confirmed bed.',
    plannedNo: 'Housing and discretionary money stop today as already agreed.',
    plannedNoStartDate: '2026-08-20',
    nextConversationDate: '2026-08-22',
  };
  plan.letters = {
    'speaker-1': { love: 'I love you.', facts: 'Two recent specific events.', request: 'Go to the named program today.', boundary: 'I will not fund continued use.', complete: true, solutionKey },
  };
  plan.rehearsal = {
    facilitatorId: 'speaker-1', debateHolderId: 'speaker-1', speakerOrder: ['speaker-1'],
    durationMinutes: 30, makeAskOnce: true, stopDebate: true, noStacking: true,
    professionalStagingRequested: false, complete: true,
    solutionKey,
  };
  plan.ama = {
    written: true, familyIsNotRide: true, houseDoesNotOpen: true, moneyDoesNotMove: true,
    callFacilityFirst: true, useTapBackup: true, note: 'Call admissions, then use the TAP backup path.',
    solutionKey,
  };
  return plan;
}

test('need-vs-agree level of care blocks a lower compromise', () => {
  const plan = completePlan();
  plan.care.planLevel = 'outpatient';
  const progress = diyInterventionProgress(plan, readyTap(), TEST_NOW);
  assert.equal(progress.stages.care.ready, false);
  assert.ok(progress.stages.care.missing.includes('planMustMatchIndicatedLevel'));
  assert.equal(progress.ready, false);
});

test('confirmed bed must match the actual intervention date', () => {
  const plan = completePlan();
  assert.equal(diyInterventionProgress(plan, readyTap({ bedConfirmedFor: '2026-08-21' }), TEST_NOW).stages.program.ready, false);
  assert.equal(diyInterventionProgress(plan, readyTap({ programName: '' }), TEST_NOW).stages.program.ready, false);
  assert.equal(diyInterventionProgress(plan, readyTap({ admissionsPhone: '' }), TEST_NOW).stages.program.ready, false);
  assert.equal(diyInterventionProgress(plan, readyTap({ bedReconfirmedAt: null }), TEST_NOW).stages.program.ready, false);
  assert.equal(diyInterventionProgress(plan, readyTap({ bedReconfirmedAt: '2026-08-01T18:00:00.000Z' }), TEST_NOW).stages.program.ready, false);
  assert.equal(diyInterventionProgress(plan, readyTap({ bedReconfirmedAt: '2026-08-19T20:00:00.000Z' }), TEST_NOW).stages.program.ready, false);
  assert.equal(diyInterventionProgress(plan, readyTap({ departureAt: '2026-08-21T14:00:00.000Z' }), TEST_NOW).stages.program.ready, false);
  assert.equal(diyInterventionProgress(plan, readyTap(), new Date('2026-08-20T15:00:00.000Z')).stages.program.ready, false);
  assert.equal(diyInterventionProgress(plan, readyTap(), TEST_NOW).stages.program.ready, true);
});

test('failed Fit Check stops later stages and letters', () => {
  const plan = completePlan();
  plan.fit.weaponInHouse = 'yes';
  assert.equal(diyFitResult(plan.fit).outcome, 'emergency');
  const access = diyStageAccess(plan, readyTap(), TEST_NOW);
  assert.equal(access.care, false);
  assert.equal(access.letters, false);
  assert.equal(diyInterventionProgress(plan, readyTap(), TEST_NOW).ready, false);
});

test('families needing logistics tutorials are sent to a professional', () => {
  const plan = completePlan();
  plan.fit.canExecuteBasicsWithoutTutorial = 'no';
  assert.equal(diyFitResult(plan.fit).outcome, 'professional');
  assert.equal(diyStageAccess(plan, readyTap(), TEST_NOW).letters, false);
});

test('unaligned team blocks ready and an uncooperative undercutter cannot speak', () => {
  let plan = completePlan();
  plan = updateDiyTeamMember(plan, 'speaker-1', { aligned: false });
  assert.equal(diyInterventionProgress(plan, readyTap(), TEST_NOW).stages.unity.ready, false);
  plan = completePlan();
  plan.undercutter = { answer: 'named', memberId: 'speaker-1', agreesToSolutionAndLeaveTime: false };
  assert.equal(diyInterventionProgress(plan, readyTap(), TEST_NOW).stages.team.ready, false);
  assert.equal(diyInterventionProgress(plan, readyTap(), TEST_NOW).ready, false);
  plan = completePlan();
  plan = updateDiyTeamMember(plan, 'support-1', { role: 'on_call', aligned: true });
  plan.undercutter = { answer: 'named', memberId: 'support-1', agreesToSolutionAndLeaveTime: false };
  assert.equal(diyInterventionProgress(plan, readyTap(), TEST_NOW).stages.team.ready, false);
  assert.equal(diyInterventionProgress(plan, readyTap(), TEST_NOW).ready, false);
});

test('active users, children, and competing plans cannot be in the room', () => {
  for (const patch of [{ activelyUsing: true }, { isChild: true }, { offersCompetingPlan: true }]) {
    const plan = updateDiyTeamMember(completePlan(), 'speaker-1', patch);
    assert.equal(diyInterventionProgress(plan, readyTap(), TEST_NOW).stages.team.ready, false);
  }
});

test('required speaker letters, rehearsal, Planned No, and AMA are hard gates', () => {
  const plan = completePlan();
  plan.letters['speaker-1'].complete = false;
  assert.equal(diyInterventionProgress(plan, readyTap(), TEST_NOW).stages.letters.ready, false);
  plan.letters['speaker-1'].complete = true;
  plan.rehearsal.complete = false;
  assert.equal(diyInterventionProgress(plan, readyTap(), TEST_NOW).stages.rehearsal.ready, false);
  plan.rehearsal.complete = true;
  plan.unity.plannedNo = '';
  assert.equal(diyInterventionProgress(plan, readyTap(), TEST_NOW).stages.unity.ready, false);
  plan.unity.plannedNo = 'Consequences start today.';
  plan.ama.familyIsNotRide = false;
  assert.equal(diyInterventionProgress(plan, readyTap(), TEST_NOW).stages.execute.ready, false);
});

test('complete plan is ready only with hydrated, saved, ready TAP', () => {
  const plan = completePlan();
  assert.equal(diyInterventionProgress(plan, readyTap(), TEST_NOW).ready, true);
  assert.equal(diyInterventionProgress(plan, readyTap({ saveState: 'saving' }), TEST_NOW).ready, false);
  assert.equal(diyInterventionProgress(plan, readyTap({ hydrated: false }), TEST_NOW).ready, false);
  assert.equal(diyInterventionProgress(plan, readyTap({ logisticsReady: false }), TEST_NOW).ready, false);
});

test('departure expiry removes readiness but preserves solution-bound day-of recording', () => {
  const plan = completePlan();
  const expiredTap = readyTap({ logisticsReady: false, dayOfRecordingReady: true });
  const atDeparture = new Date('2026-08-20T14:00:00.000Z');
  assert.equal(diyInterventionProgress(plan, expiredTap, atDeparture).ready, false);
  assert.equal(diyInterventionProgress(plan, expiredTap, atDeparture).stages.program.ready, false);
  assert.equal(diyStageAccess(plan, expiredTap, atDeparture).execute, true);
  assert.equal(diyStageAccess(plan, { ...expiredTap, dayOfRecordingReady: false }, atDeparture).execute, false);
  assert.equal(diyStageAccess(plan, { ...expiredTap, programName: 'Changed program' }, atDeparture).execute, false);
});

test('changed TAP facts invalidate downstream attestations even if its meta revision tears', () => {
  const plan = completePlan();
  const changedTap = readyTap({ programName: 'Different Program' });
  const result = diyInterventionProgress(plan, changedTap, TEST_NOW);
  assert.equal(result.stages.program.ready, true);
  assert.equal(result.stages.unity.ready, false);
  assert.equal(result.stages.letters.ready, false);
  assert.equal(result.stages.rehearsal.ready, false);
  assert.equal(result.stages.execute.ready, false);
  const changedLogistics = diyInterventionProgress(plan, readyTap({ logisticsFingerprint: '{"transport":"Taylor","backup":"Casey"}' }), TEST_NOW);
  assert.equal(changedLogistics.stages.unity.ready, false);
});

test('rehearsal leaders must be aligned participants who will be in the room', () => {
  let plan = completePlan();
  plan.rehearsal.facilitatorId = 'support-1';
  plan = updateDiyTeamMember(plan, 'support-1', { role: 'on_call' });
  assert.equal(diyInterventionProgress(plan, readyTap(), TEST_NOW).stages.rehearsal.ready, false);
});

test('protected chapter records round-trip, stay bounded, and fail closed when partial', () => {
  const plan = completePlan();
  const records = serializeDiyProtectedParts(plan);
  for (const part of DIY_CURRENT_PROTECTED_PARTS) assert.ok(new TextEncoder().encode(records[part]).length <= 1800, part);
  assert.deepEqual(parseCurrentDiyProtectedParts(records), plan);
  const currentAbsent = Object.fromEntries(DIY_CURRENT_PROTECTED_PARTS.map((part) => [part, null])) as Record<DiyCurrentProtectedPart, string | null>;
  assert.equal(parseCurrentDiyProtectedParts(currentAbsent).team.length, 0);
  assert.throws(() => parseCurrentDiyProtectedParts({ ...currentAbsent, core: records.core }), /incomplete_record_set/);
  assert.throws(() => parseCurrentDiyProtectedParts({ ...records, team: '{bad json' }), /invalid_json_team/);
  const newer = serializeDiyProtectedParts({ ...plan, updatedAt: '2026-08-20T18:00:00.000Z' });
  assert.throws(() => parseCurrentDiyProtectedParts({ ...records, team: newer.team }), /revision_mismatch/);
  assert.throws(() => parseCurrentDiyProtectedParts({ ...records, team_extra: null }), /incomplete_record_set/);

  const absent = Object.fromEntries(DIY_PROTECTED_PARTS.map((part) => [part, null])) as Record<DiyProtectedPart, string | null>;
  assert.equal(parseDiyProtectedParts(absent).team.length, 0);
  const revision = 'legacy-revision';
  const letterMap = (key: 'love' | 'facts' | 'request' | 'boundary') =>
    Object.fromEntries(Object.entries(plan.letters).map(([id, letter]) => [id, letter[key]]));
  const legacyData: Record<DiyProtectedPart, unknown> = {
    core: { fit: plan.fit, care: plan.care, interventionDate: plan.interventionDate, updatedAt: plan.updatedAt },
    team: { team: plan.team, undercutter: plan.undercutter }, team_extra: { team: [] },
    unity: { unity: plan.unity, ama: plan.ama, dayOf: plan.dayOf }, rehearsal: plan.rehearsal,
    letter_love: letterMap('love'), letter_facts: letterMap('facts'), letter_request: letterMap('request'),
    letter_boundary: letterMap('boundary'),
    letter_complete: Object.fromEntries(Object.entries(plan.letters).map(([id, letter]) => [id, { complete: letter.complete, solutionKey: letter.solutionKey }])),
  };
  const legacyRecords = Object.fromEntries(DIY_PROTECTED_PARTS.map((part) => [
    part, part === 'team_extra' ? null : JSON.stringify({ revision, data: legacyData[part] }),
  ])) as Record<DiyProtectedPart, string | null>;
  assert.deepEqual(parseDiyProtectedParts(legacyRecords), plan);
  const migratedLegacyRecords = { ...legacyRecords, team_extra: legacyDiyTeamExtraRecord(legacyRecords) };
  assert.deepEqual(parseDiyProtectedParts(migratedLegacyRecords), plan);
  const orphanLetters = { ...records };
  const love = JSON.parse(orphanLetters.letter_love) as { revision: string; data: Record<string, string> };
  love.data.orphan = 'not a team member';
  orphanLetters.letter_love = JSON.stringify(love);
  assert.throws(() => parseCurrentDiyProtectedParts(orphanLetters), /invalid_letter_member/);
});

test('six maximum-size team members fit protected chapter ceilings', () => {
  let plan = defaultDiyInterventionPlan();
  for (let index = 0; index < DIY_TEAM_LIMIT; index += 1) {
    plan = addDiyTeamMember(plan, {
      id: `${index}`.padEnd(DIY_TEAM_ID_LIMIT, 'i'),
      name: '"'.repeat(DIY_TEAM_TEXT_LIMIT),
      relationship: '\\'.repeat(DIY_TEAM_TEXT_LIMIT),
      role: 'silent_support',
    });
  }
  const records = serializeDiyProtectedParts(plan);
  for (const part of DIY_CURRENT_PROTECTED_PARTS) assert.ok(new TextEncoder().encode(records[part]).length <= 1800, part);
  assert.deepEqual(parseCurrentDiyProtectedParts(records), plan);
});

test('maximum escaped unity and six-member letters fit every protected chapter', () => {
  let plan = defaultDiyInterventionPlan();
  for (let index = 0; index < DIY_TEAM_LIMIT; index += 1) {
    plan = addDiyTeamMember(plan, { id: `member-${index}`, name: `Name ${index}`, relationship: 'Family', role: 'speaker' });
    plan.letters[`member-${index}`] = {
      love: '"'.repeat(200), facts: '\\'.repeat(200), request: '"'.repeat(200), boundary: '\\'.repeat(200),
      complete: true, solutionKey: 's'.repeat(160),
    };
  }
  plan.unity = {
    solutionConfirmed: true, solutionKey: 's'.repeat(160), yesPlan: '"'.repeat(240), plannedNo: '\\'.repeat(240),
    plannedNoStartDate: '2026-08-20', nextConversationDate: '2026-08-22',
  };
  plan.ama = { ...plan.ama, note: '"'.repeat(240), solutionKey: 's'.repeat(160) };
  const records = serializeDiyProtectedParts(plan);
  for (const part of DIY_CURRENT_PROTECTED_PARTS) assert.ok(new TextEncoder().encode(records[part]).length <= 1800, part);
  assert.deepEqual(parseCurrentDiyProtectedParts(records), plan);
});

test('team text strips control characters before protected save', () => {
  const plan = addDiyTeamMember(defaultDiyInterventionPlan(), {
    id: 'safe-member', name: 'Alex\u0000\nBrown', relationship: 'Sibling\u007f', role: 'speaker',
  });
  assert.equal(plan.team[0].name, 'AlexBrown');
  assert.equal(plan.team[0].relationship, 'Sibling');
  assert.doesNotThrow(() => serializeDiyProtectedParts(plan));
});

test('route enforces Essentials paywall and product prohibitions', () => {
  const route = readFileSync(resolve(TEST_DIR, '../app/diy-intervention-planner.tsx'), 'utf8');
  const en = readFileSync(resolve(TEST_DIR, '../src/locales/en/diyInterventionPlanner.json'), 'utf8');
  const es = readFileSync(resolve(TEST_DIR, '../src/locales/es/diyInterventionPlanner.json'), 'utf8');
  const product = `${route}\n${en}\n${es}`.toLowerCase();
  assert.match(route, /<Gate[\s\S]*feature="diyIntervention"/);
  assert.doesNotMatch(route, /accountState\s*===\s*['"]direct-free['"]/);
  assert.match(route, /<FreeTierPaywall/);
  assert.match(route, /useTreatmentActionPlan/);
  assert.match(route, /leaveTonightProgress/);
  assert.match(route, /logisticsReady: tapProgress\.ready && leaveTonight\.ready/);
  assert.match(route, /setInterval\(\(\) => setNowMs\(Date\.now\(\)\), 1_000\)/);
  assert.match(route, /AppState\.addEventListener\('change'/);
  assert.match(route, /diyInterventionProgress\(diy\.plan, tapSnapshot, now\)/);
  assert.match(route, /diyStageAccess\(diy\.plan, tapSnapshot, now\)/);
  assert.match(route, /router\.push\('\/treatment-action-plan'/);
  assert.match(route, /accessibilityRole="radiogroup"/);
  assert.match(route, /helpNow/);
  assert.match(route, /tel:911/);
  assert.match(route, /tel:988/);
  assert.doesNotMatch(product, /walk to the car|caminar al auto|caminar al coche/);
  assert.doesNotMatch(product, /sponsored placement|ranked facilit|ubicaciones patrocinadas|centros clasificados/);
  assert.doesNotMatch(product, /social security|policy number|prescription list|seguro social|número de póliza|lista de recetas/);
});

test('localization parity, protected storage, route, Tools, TAP, and CI are wired', () => {
  const en = JSON.parse(readFileSync(resolve(TEST_DIR, '../src/locales/en/diyInterventionPlanner.json'), 'utf8')) as Record<string, unknown>;
  const es = JSON.parse(readFileSync(resolve(TEST_DIR, '../src/locales/es/diyInterventionPlanner.json'), 'utf8')) as Record<string, unknown>;
  const keys = (value: Record<string, unknown>, prefix = ''): string[] => Object.entries(value).flatMap(([key, row]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return row && typeof row === 'object' && !Array.isArray(row) ? keys(row as Record<string, unknown>, path) : [path];
  }).sort();
  assert.deepEqual(keys(en), keys(es));
  const storage = readFileSync(resolve(TEST_DIR, '../src/storage/diyInterventionPlanner.ts'), 'utf8');
  const hook = readFileSync(resolve(TEST_DIR, '../src/hooks/useDiyInterventionPlanner.ts'), 'utf8');
  const tools = readFileSync(resolve(TEST_DIR, '../app/(tabs)/learn.tsx'), 'utf8');
  const tap = readFileSync(resolve(TEST_DIR, '../app/treatment-action-plan.tsx'), 'utf8');
  const tapDomain = readFileSync(resolve(TEST_DIR, '../src/lib/treatmentActionPlan.ts'), 'utf8');
  const workflow = readFileSync(resolve(TEST_DIR, '../.github/workflows/quality.yml'), 'utf8');
  assert.match(storage, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.match(storage, /Promise\.allSettled/);
  assert.match(storage, /diyInterventionCommitStorageKey/);
  assert.match(storage, /diyInterventionSlotStorageKey/);
  assert.ok(storage.indexOf('await awaitEvery(DIY_CURRENT_PROTECTED_PARTS')
    < storage.lastIndexOf('await SecureStore.setItemAsync(diyInterventionCommitStorageKey'));
  assert.match(storage, /accountId/);
  assert.match(hook, /readVersion/);
  assert.match(hook, /await coordinator\.queue\.catch/);
  assert.match(hook, /mutationVersion !== coordinator\.version/);
  assert.ok((hook.match(/if \(coordinator\.hadFailure\)/g) ?? []).length >= 3);
  assert.match(hook, /lastSettledLoadState/);
  assert.match(hook, /coordinator\.hadFailure = true/);
  assert.match(hook, /clearing/);
  assert.match(hook, /loadState: 'error'/);
  assert.match(tools, /diy-intervention-planner/);
  assert.match(tap, /diy-intervention-planner/);
  assert.match(tapDomain, /TreatmentPlacementDetails/);
  assert.doesNotMatch(tapDomain.match(/export type TreatmentPlacementDetails = \{[\s\S]*?\};/)?.[0] ?? '', /admissionsPhone/);
  assert.match(workflow, /test:diy-intervention/);
});
