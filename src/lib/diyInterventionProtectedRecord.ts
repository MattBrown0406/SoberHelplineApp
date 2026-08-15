import {
  defaultDiyInterventionPlan,
  DIY_LETTER_SECTION_LIMIT,
  DIY_TEAM_ID_LIMIT,
  DIY_TEAM_LIMIT,
  DIY_TEAM_TEXT_LIMIT,
  DIY_TEXT_LIMIT,
  type DiyAnswer,
  type DiyInterventionPlan,
  type DiyLevelOfCare,
  type DiyTeamRole,
} from './diyInterventionPlanner';
import {
  DIY_CURRENT_PROTECTED_PARTS,
  DIY_PROTECTED_PARTS,
  type DiyCurrentProtectedPart,
  type DiyProtectedPart,
} from './diyInterventionStorageKeys';

const PART_BYTE_LIMIT = 1800;
const ANSWERS = ['', 'yes', 'no'];
const LEVELS = ['', 'detox', 'residential', 'php', 'iop', 'outpatient'];
const ROLES = ['', 'speaker', 'silent_support', 'not_in_room', 'on_call'];

function bytes(value: string): number {
  let total = 0;
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    total += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return total;
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`protected_diy_invalid_${label}`);
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, limit = DIY_TEXT_LIMIT): string {
  if (typeof value !== 'string' || bytes(value) > limit) throw new Error(`protected_diy_invalid_${label}`);
  return value;
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`protected_diy_invalid_${label}`);
  return value;
}
function nullableBool(value: unknown, label: string): boolean | null {
  if (value !== null && typeof value !== 'boolean') throw new Error(`protected_diy_invalid_${label}`);
  return value;
}
function nullableDate(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !Number.isFinite(new Date(value).getTime())) throw new Error(`protected_diy_invalid_${label}`);
  return value;
}
function parsePart(raw: string, part: string, enforcePartLimit = true): Record<string, unknown> {
  if (enforcePartLimit && bytes(raw) > PART_BYTE_LIMIT) throw new Error(`protected_diy_oversized_${part}`);
  try { return object(JSON.parse(raw) as unknown, part); } catch (error) {
    if (error instanceof Error && error.message.startsWith('protected_diy_')) throw error;
    throw new Error(`protected_diy_invalid_json_${part}`);
  }
}
export function isLegacyDiyProtectedParts(parts: Record<DiyProtectedPart, string | null>): boolean {
  if (parts.team_extra !== null) return false;
  const legacyParts = DIY_PROTECTED_PARTS.filter((part) => part !== 'team_extra');
  if (legacyParts.some((part) => parts[part] === null)) return false;
  return legacyParts.every((part) => !Object.prototype.hasOwnProperty.call(parsePart(parts[part]!, part), 'schemaVersion'));
}
export function legacyDiyTeamExtraRecord(parts: Record<DiyProtectedPart, string | null>): string {
  if (!isLegacyDiyProtectedParts(parts)) throw new Error('protected_diy_invalid_legacy_record_set');
  const revision = parsePart(parts.team!, 'team').revision;
  if (typeof revision !== 'string') throw new Error('protected_diy_revision_mismatch');
  return JSON.stringify({ revision, data: { team: [] } });
}
function answer(value: unknown, label: string): DiyAnswer {
  if (!ANSWERS.includes(value as string)) throw new Error(`protected_diy_invalid_${label}`);
  return value as DiyAnswer;
}
function level(value: unknown, label: string): DiyLevelOfCare {
  if (!LEVELS.includes(value as string)) throw new Error(`protected_diy_invalid_${label}`);
  return value as DiyLevelOfCare;
}
function role(value: unknown, label: string): DiyTeamRole {
  if (!ROLES.includes(value as string)) throw new Error(`protected_diy_invalid_${label}`);
  return value as DiyTeamRole;
}
function teamText(value: unknown, label: string): string {
  const parsed = string(value, label, DIY_TEAM_TEXT_LIMIT);
  if (/[\u0000-\u001f\u007f-\u009f]/.test(parsed)) throw new Error(`protected_diy_invalid_${label}`);
  return parsed;
}

export function parseDiyProtectedParts(
  parts: Record<DiyProtectedPart, string | null>,
  enforcePartLimit = true,
): DiyInterventionPlan {
  const present = DIY_PROTECTED_PARTS.filter((part) => parts[part] !== null);
  if (!present.length) return defaultDiyInterventionPlan();
  const wrapped = Object.fromEntries(present.map((part) => [part, parsePart(parts[part]!, part, enforcePartLimit)])) as Partial<Record<DiyProtectedPart, Record<string, unknown>>>;
  const legacyTeamRecord = enforcePartLimit && isLegacyDiyProtectedParts(parts);
  const fullLegacyTeamRecord = present.length === DIY_PROTECTED_PARTS.length
    && present.every((part) => wrapped[part]!.schemaVersion === undefined);
  const legacyTeamLayout = legacyTeamRecord || fullLegacyTeamRecord;
  if (present.length !== DIY_PROTECTED_PARTS.length && !legacyTeamRecord) throw new Error('protected_diy_incomplete_record_set');
  if (!legacyTeamLayout && present.some((part) => wrapped[part]!.schemaVersion !== 2)) throw new Error('protected_diy_schema_mismatch');
  const revisions = present.map((part) => wrapped[part]!.revision);
  if (revisions.some((revision) => typeof revision !== 'string' || revision !== revisions[0])) {
    throw new Error('protected_diy_revision_mismatch');
  }
  const rows = {
    ...Object.fromEntries(present.map((part) => [part, object(wrapped[part]!.data, `${part}_data`)])),
    ...(legacyTeamRecord ? { team_extra: { team: [] } } : {}),
  } as unknown as Record<DiyProtectedPart, Record<string, unknown>>;
  const core = rows.core;
  const fitRow = object(core.fit, 'fit');
  const careRow = object(core.care, 'care');
  const fit = {
    recentViolence: answer(fitRow.recentViolence, 'recentViolence'),
    weaponInHouse: answer(fitRow.weaponInHouse, 'weaponInHouse'),
    activePsychosis: answer(fitRow.activePsychosis, 'activePsychosis'),
    overdoseLastDay: answer(fitRow.overdoseLastDay, 'overdoseLastDay'),
    childrenCannotExit: answer(fitRow.childrenCannotExit, 'childrenCannotExit'),
    familyUnitedOnOneSolution: answer(fitRow.familyUnitedOnOneSolution, 'familyUnitedOnOneSolution'),
    canExecuteBasicsWithoutTutorial: answer(fitRow.canExecuteBasicsWithoutTutorial, 'canExecuteBasicsWithoutTutorial'),
  };
  const care = {
    indicatedLevel: level(careRow.indicatedLevel, 'indicatedLevel'),
    whyThisLevel: string(careRow.whyThisLevel, 'whyThisLevel'),
    acceptedPreferenceLevel: level(careRow.acceptedPreferenceLevel, 'acceptedPreferenceLevel'),
    planLevel: level(careRow.planLevel, 'planLevel'),
  };
  const teamRow = rows.team;
  const extraTeamRow = rows.team_extra;
  if (!Array.isArray(teamRow.team) || !Array.isArray(extraTeamRow.team)) throw new Error('protected_diy_invalid_team');
  if (teamRow.team.length > (legacyTeamLayout ? DIY_TEAM_LIMIT : 3) || extraTeamRow.team.length > DIY_TEAM_LIMIT - 3) throw new Error('protected_diy_invalid_team');
  const protectedTeam = [...teamRow.team, ...extraTeamRow.team];
  if (protectedTeam.length > DIY_TEAM_LIMIT) throw new Error('protected_diy_invalid_team');
  const ids = new Set<string>();
  const team = protectedTeam.map((value, index) => {
    const row = object(value, `team_${index}`);
    const id = string(row.id, `team_${index}_id`, DIY_TEAM_ID_LIMIT);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || ids.has(id)) throw new Error('protected_diy_invalid_team_id');
    ids.add(id);
    return {
      id,
      name: teamText(row.name, `team_${index}_name`),
      relationship: teamText(row.relationship, `team_${index}_relationship`),
      role: role(row.role, `team_${index}_role`),
      activelyUsing: nullableBool(row.activelyUsing, `team_${index}_activelyUsing`),
      offersCompetingPlan: nullableBool(row.offersCompetingPlan, `team_${index}_offersCompetingPlan`),
      isChild: nullableBool(row.isChild, `team_${index}_isChild`),
      aligned: nullableBool(row.aligned, `team_${index}_aligned`),
    };
  });
  const underRow = object(teamRow.undercutter, 'undercutter');
  if (!['', 'none', 'named'].includes(underRow.answer as string)) throw new Error('protected_diy_invalid_undercutter_answer');
  const undercutter = {
    answer: underRow.answer as '' | 'none' | 'named',
    memberId: string(underRow.memberId, 'undercutter_member', DIY_TEAM_ID_LIMIT),
    agreesToSolutionAndLeaveTime: nullableBool(underRow.agreesToSolutionAndLeaveTime, 'undercutter_agreement'),
  };
  if (undercutter.answer === 'named' && !ids.has(undercutter.memberId)) throw new Error('protected_diy_invalid_undercutter_member');
  const unityContainer = rows.unity;
  const unityRow = object(unityContainer.unity, 'unity');
  const unity = {
    solutionConfirmed: bool(unityRow.solutionConfirmed, 'solutionConfirmed'),
    solutionKey: string(unityRow.solutionKey, 'unitySolutionKey', 160),
    yesPlan: string(unityRow.yesPlan, 'yesPlan'),
    plannedNo: string(unityRow.plannedNo, 'plannedNo'),
    plannedNoStartDate: string(unityRow.plannedNoStartDate, 'plannedNoStartDate'),
    nextConversationDate: string(unityRow.nextConversationDate, 'nextConversationDate'),
  };
  const amaRow = object(unityContainer.ama, 'ama');
  const ama = {
    written: bool(amaRow.written, 'amaWritten'),
    familyIsNotRide: bool(amaRow.familyIsNotRide, 'familyIsNotRide'),
    houseDoesNotOpen: bool(amaRow.houseDoesNotOpen, 'houseDoesNotOpen'),
    moneyDoesNotMove: bool(amaRow.moneyDoesNotMove, 'moneyDoesNotMove'),
    callFacilityFirst: bool(amaRow.callFacilityFirst, 'callFacilityFirst'),
    useTapBackup: bool(amaRow.useTapBackup, 'useTapBackup'),
    note: string(amaRow.note, 'amaNote'),
    solutionKey: string(amaRow.solutionKey, 'amaSolutionKey', 160),
  };
  const dayRow = object(unityContainer.dayOf, 'dayOf');
  if (!['', 'yes_left_for_program', 'planned_no_started'].includes(dayRow.outcome as string)) throw new Error('protected_diy_invalid_day_outcome');
  const dayOf = {
    bedReconfirmedMorning: bool(dayRow.bedReconfirmedMorning, 'bedReconfirmedMorning'),
    teamArrived: bool(dayRow.teamArrived, 'teamArrived'),
    phonesHandled: bool(dayRow.phonesHandled, 'phonesHandled'),
    lettersInOrder: bool(dayRow.lettersInOrder, 'lettersInOrder'),
    askMadeOnce: bool(dayRow.askMadeOnce, 'askMadeOnce'),
    outcome: dayRow.outcome as '' | 'yes_left_for_program' | 'planned_no_started',
    completedAt: nullableDate(dayRow.completedAt, 'dayCompletedAt'),
  };
  const rehearsalRow = rows.rehearsal;
  if (!Array.isArray(rehearsalRow.speakerOrder) || rehearsalRow.speakerOrder.some((value) => typeof value !== 'string')) throw new Error('protected_diy_invalid_speaker_order');
  if (new Set(rehearsalRow.speakerOrder).size !== rehearsalRow.speakerOrder.length || rehearsalRow.speakerOrder.some((value) => !ids.has(value as string))) throw new Error('protected_diy_invalid_speaker_order');
  if (rehearsalRow.durationMinutes !== null && (typeof rehearsalRow.durationMinutes !== 'number' || !Number.isFinite(rehearsalRow.durationMinutes))) throw new Error('protected_diy_invalid_duration');
  const rehearsal = {
    facilitatorId: string(rehearsalRow.facilitatorId, 'facilitatorId', DIY_TEAM_ID_LIMIT),
    debateHolderId: string(rehearsalRow.debateHolderId, 'debateHolderId', DIY_TEAM_ID_LIMIT),
    speakerOrder: rehearsalRow.speakerOrder as string[],
    durationMinutes: rehearsalRow.durationMinutes as number | null,
    makeAskOnce: bool(rehearsalRow.makeAskOnce, 'makeAskOnce'),
    stopDebate: bool(rehearsalRow.stopDebate, 'stopDebate'),
    noStacking: bool(rehearsalRow.noStacking, 'noStacking'),
    professionalStagingRequested: bool(rehearsalRow.professionalStagingRequested, 'professionalStagingRequested'),
    complete: bool(rehearsalRow.complete, 'rehearsalComplete'),
    solutionKey: string(rehearsalRow.solutionKey, 'rehearsalSolutionKey', 160),
  };
  if ((rehearsal.facilitatorId && !ids.has(rehearsal.facilitatorId)) || (rehearsal.debateHolderId && !ids.has(rehearsal.debateHolderId))) {
    throw new Error('protected_diy_invalid_rehearsal_member');
  }
  const sectionMaps = {
    love: rows.letter_love, facts: rows.letter_facts, request: rows.letter_request,
    boundary: rows.letter_boundary, complete: rows.letter_complete,
  };
  for (const section of Object.values(sectionMaps)) {
    if (Object.keys(section).some((id) => !ids.has(id))) throw new Error('protected_diy_invalid_letter_member');
  }
  const letters: DiyInterventionPlan['letters'] = {};
  for (const id of ids) {
    const values = [sectionMaps.love[id], sectionMaps.facts[id], sectionMaps.request[id], sectionMaps.boundary[id], sectionMaps.complete[id]];
    if (values.every((value) => value === undefined)) continue;
    const completion = object(values[4], `letter_${id}_completion`);
    letters[id] = {
      love: string(values[0], `letter_${id}_love`, DIY_LETTER_SECTION_LIMIT),
      facts: string(values[1], `letter_${id}_facts`, DIY_LETTER_SECTION_LIMIT),
      request: string(values[2], `letter_${id}_request`, DIY_LETTER_SECTION_LIMIT),
      boundary: string(values[3], `letter_${id}_boundary`, DIY_LETTER_SECTION_LIMIT),
      complete: bool(completion.complete, `letter_${id}_complete`),
      solutionKey: string(completion.solutionKey, `letter_${id}_solutionKey`, 160),
    };
  }
  return {
    fit, care, interventionDate: string(core.interventionDate, 'interventionDate'), team, undercutter, unity, letters,
    rehearsal, ama, dayOf, updatedAt: nullableDate(core.updatedAt, 'updatedAt'),
  };
}

export function parseCurrentDiyProtectedParts(
  parts: Record<DiyCurrentProtectedPart, string | null>,
): DiyInterventionPlan {
  const present = DIY_CURRENT_PROTECTED_PARTS.filter((part) => parts[part] !== null);
  if (!present.length) return defaultDiyInterventionPlan();
  if (present.length !== DIY_CURRENT_PROTECTED_PARTS.length) throw new Error('protected_diy_incomplete_record_set');
  const wrapped = Object.fromEntries(DIY_CURRENT_PROTECTED_PARTS.map((part) => [part, parsePart(parts[part]!, part)])) as Record<DiyCurrentProtectedPart, Record<string, unknown>>;
  if (DIY_CURRENT_PROTECTED_PARTS.some((part) => wrapped[part].schemaVersion !== 3)) {
    throw new Error('protected_diy_schema_mismatch');
  }
  const revision = wrapped.core.revision;
  if (typeof revision !== 'string'
    || DIY_CURRENT_PROTECTED_PARTS.some((part) => wrapped[part].revision !== revision)) {
    throw new Error('protected_diy_revision_mismatch');
  }
  const data = Object.fromEntries(DIY_CURRENT_PROTECTED_PARTS.map((part) => [part, object(wrapped[part].data, `${part}_data`)])) as Record<DiyCurrentProtectedPart, Record<string, unknown>>;
  const merge = (first: Record<string, unknown>, second: Record<string, unknown>) => ({ ...first, ...second });
  const legacyRows: Record<DiyProtectedPart, unknown> = {
    core: data.core,
    team: data.team,
    team_extra: data.team_extra,
    unity: { ...data.unity, ...data.unity_extra },
    rehearsal: data.rehearsal,
    letter_love: merge(data.letter_love, data.letter_love_extra),
    letter_facts: merge(data.letter_facts, data.letter_facts_extra),
    letter_request: merge(data.letter_request, data.letter_request_extra),
    letter_boundary: merge(data.letter_boundary, data.letter_boundary_extra),
    letter_complete: merge(data.letter_complete, data.letter_complete_extra),
  };
  const synthetic = Object.fromEntries(DIY_PROTECTED_PARTS.map((part) => [
    part,
    JSON.stringify({ schemaVersion: 2, revision, data: legacyRows[part] }),
  ])) as Record<DiyProtectedPart, string | null>;
  return parseDiyProtectedParts(synthetic, false);
}

export function serializeDiyProtectedParts(plan: DiyInterventionPlan): Record<DiyCurrentProtectedPart, string> {
  const entries = Object.entries(plan.letters);
  const letterMap = <K extends 'love' | 'facts' | 'request' | 'boundary' | 'complete'>(key: K, start: number) =>
    Object.fromEntries(entries.slice(start, start + 3).map(([id, letter]) => [id, letter[key]]));
  const completionMap = (start: number) => Object.fromEntries(entries.slice(start, start + 3)
    .map(([id, letter]) => [id, { complete: letter.complete, solutionKey: letter.solutionKey }]));
  const records: Record<DiyCurrentProtectedPart, unknown> = {
    core: { fit: plan.fit, care: plan.care, interventionDate: plan.interventionDate, updatedAt: plan.updatedAt },
    team: { team: plan.team.slice(0, 3), undercutter: plan.undercutter },
    team_extra: { team: plan.team.slice(3) },
    unity: { unity: plan.unity },
    unity_extra: { ama: plan.ama, dayOf: plan.dayOf },
    rehearsal: plan.rehearsal,
    letter_love: letterMap('love', 0), letter_love_extra: letterMap('love', 3),
    letter_facts: letterMap('facts', 0), letter_facts_extra: letterMap('facts', 3),
    letter_request: letterMap('request', 0), letter_request_extra: letterMap('request', 3),
    letter_boundary: letterMap('boundary', 0), letter_boundary_extra: letterMap('boundary', 3),
    letter_complete: completionMap(0), letter_complete_extra: completionMap(3),
  };
  const nonce = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  const revision = `${plan.updatedAt ?? 'initial'}:${Date.now().toString(36)}:${nonce}`;
  return Object.fromEntries(DIY_CURRENT_PROTECTED_PARTS.map((part) => {
    const raw = JSON.stringify({ schemaVersion: 3, revision, data: records[part] });
    if (bytes(raw) > PART_BYTE_LIMIT) throw new Error(`protected_diy_oversized_${part}`);
    return [part, raw];
  })) as Record<DiyCurrentProtectedPart, string>;
}
