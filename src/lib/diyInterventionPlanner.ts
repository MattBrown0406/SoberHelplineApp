export type DiyAnswer = '' | 'yes' | 'no';
export type DiyLevelOfCare = '' | 'detox' | 'residential' | 'php' | 'iop' | 'outpatient';
export type DiyTeamRole = '' | 'speaker' | 'silent_support' | 'not_in_room' | 'on_call';

export type DiyFit = {
  recentViolence: DiyAnswer;
  weaponInHouse: DiyAnswer;
  activePsychosis: DiyAnswer;
  overdoseLastDay: DiyAnswer;
  childrenCannotExit: DiyAnswer;
  familyUnitedOnOneSolution: DiyAnswer;
  canExecuteBasicsWithoutTutorial: DiyAnswer;
};

export type DiyCare = {
  indicatedLevel: DiyLevelOfCare;
  whyThisLevel: string;
  acceptedPreferenceLevel: DiyLevelOfCare;
  planLevel: DiyLevelOfCare;
};

export type DiyTeamMember = {
  id: string;
  name: string;
  relationship: string;
  role: DiyTeamRole;
  activelyUsing: boolean | null;
  offersCompetingPlan: boolean | null;
  isChild: boolean | null;
  aligned: boolean | null;
};

export type DiyUndercutter = {
  answer: '' | 'none' | 'named';
  memberId: string;
  agreesToSolutionAndLeaveTime: boolean | null;
};

export type DiyUnity = {
  solutionConfirmed: boolean;
  solutionKey: string;
  yesPlan: string;
  plannedNo: string;
  plannedNoStartDate: string;
  nextConversationDate: string;
};

export type DiyLetter = {
  love: string;
  facts: string;
  request: string;
  boundary: string;
  complete: boolean;
  solutionKey: string;
};

export type DiyRehearsal = {
  facilitatorId: string;
  debateHolderId: string;
  speakerOrder: string[];
  durationMinutes: number | null;
  makeAskOnce: boolean;
  stopDebate: boolean;
  noStacking: boolean;
  professionalStagingRequested: boolean;
  complete: boolean;
  solutionKey: string;
};

export type DiyAmaPlan = {
  written: boolean;
  familyIsNotRide: boolean;
  houseDoesNotOpen: boolean;
  moneyDoesNotMove: boolean;
  callFacilityFirst: boolean;
  useTapBackup: boolean;
  note: string;
  solutionKey: string;
};

export type DiyDayOf = {
  bedReconfirmedMorning: boolean;
  teamArrived: boolean;
  phonesHandled: boolean;
  lettersInOrder: boolean;
  askMadeOnce: boolean;
  outcome: '' | 'yes_left_for_program' | 'planned_no_started';
  completedAt: string | null;
};

export type DiyInterventionPlan = {
  fit: DiyFit;
  care: DiyCare;
  interventionDate: string;
  team: DiyTeamMember[];
  undercutter: DiyUndercutter;
  unity: DiyUnity;
  letters: Record<string, DiyLetter>;
  rehearsal: DiyRehearsal;
  ama: DiyAmaPlan;
  dayOf: DiyDayOf;
  updatedAt: string | null;
};

export type DiyTapSnapshot = {
  hydrated: boolean;
  saveState: 'saved' | 'saving' | 'error';
  logisticsReady: boolean;
  dayOfRecordingReady: boolean;
  programName: string;
  admissionsContactName: string;
  admissionsPhone: string;
  bedConfirmedFor: string;
  bedConfirmationWindow: string;
  bedConfirmedBy: string;
  bedReconfirmedAt: string | null;
  departureAt: string | null;
  revision: string | null;
  logisticsFingerprint: string;
};

export const DIY_TEXT_LIMIT = 240;
export const DIY_LETTER_SECTION_LIMIT = 200;
export const DIY_TEAM_TEXT_LIMIT = 80;
export const DIY_TEAM_ID_LIMIT = 64;
export const DIY_TEAM_LIMIT = 6;

const blankFit = (): DiyFit => ({
  recentViolence: '', weaponInHouse: '', activePsychosis: '', overdoseLastDay: '', childrenCannotExit: '',
  familyUnitedOnOneSolution: '', canExecuteBasicsWithoutTutorial: '',
});

const blankCare = (): DiyCare => ({ indicatedLevel: '', whyThisLevel: '', acceptedPreferenceLevel: '', planLevel: '' });
const blankUnity = (): DiyUnity => ({ solutionConfirmed: false, solutionKey: '', yesPlan: '', plannedNo: '', plannedNoStartDate: '', nextConversationDate: '' });
const blankRehearsal = (): DiyRehearsal => ({
  facilitatorId: '', debateHolderId: '', speakerOrder: [], durationMinutes: null, makeAskOnce: false,
  stopDebate: false, noStacking: false, professionalStagingRequested: false, complete: false, solutionKey: '',
});
const blankAma = (): DiyAmaPlan => ({
  written: false, familyIsNotRide: false, houseDoesNotOpen: false, moneyDoesNotMove: false,
  callFacilityFirst: false, useTapBackup: false, note: '', solutionKey: '',
});
const blankDayOf = (): DiyDayOf => ({
  bedReconfirmedMorning: false, teamArrived: false, phonesHandled: false, lettersInOrder: false,
  askMadeOnce: false, outcome: '', completedAt: null,
});

export function defaultDiyInterventionPlan(): DiyInterventionPlan {
  return {
    fit: blankFit(), care: blankCare(), interventionDate: '', team: [],
    undercutter: { answer: '', memberId: '', agreesToSolutionAndLeaveTime: null },
    unity: blankUnity(), letters: {}, rehearsal: blankRehearsal(), ama: blankAma(), dayOf: blankDayOf(), updatedAt: null,
  };
}

function cap(value: string, limit = DIY_TEXT_LIMIT): string {
  let output = '';
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    const size = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes + size > limit) break;
    output += character;
    bytes += size;
  }
  return output;
}
function capTeamText(value: string): string {
  return cap(value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ''), DIY_TEAM_TEXT_LIMIT);
}
function safeTeamMemberId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validPhone(value: string): boolean {
  if (!/^\+?[\d\s().-]+$/.test(value.trim())) return false;
  const count = value.replace(/\D/g, '').length;
  return count >= 7 && count <= 15;
}

function localDateOf(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function previousDate(value: string): string | null {
  if (!validDate(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function diySolutionKey(plan: DiyInterventionPlan, tap: DiyTapSnapshot): string {
  if (!tap.revision || !plan.care.indicatedLevel || !plan.care.planLevel || !plan.interventionDate) return '';
  const facts = JSON.stringify([
    tap.revision,
    plan.interventionDate,
    plan.care.indicatedLevel,
    plan.care.planLevel,
    tap.programName,
    tap.admissionsContactName,
    tap.admissionsPhone,
    tap.bedConfirmedFor,
    tap.bedConfirmationWindow,
    tap.bedConfirmedBy,
    tap.bedReconfirmedAt,
    tap.departureAt,
    tap.logisticsFingerprint,
  ]);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < facts.length; index += 1) {
    const code = facts.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code, 0x85ebca6b) >>> 0;
  }
  return `v1:${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

export function diyFitResult(fit: DiyFit): { outcome: 'incomplete' | 'pass' | 'emergency' | 'professional'; reasons: string[] } {
  const riskKeys = ['recentViolence', 'weaponInHouse', 'activePsychosis', 'overdoseLastDay', 'childrenCannotExit'] as const;
  const reasons = riskKeys.filter((key) => fit[key] === 'yes');
  if (reasons.length) return { outcome: 'emergency', reasons };
  if (riskKeys.some((key) => fit[key] === '')) return { outcome: 'incomplete', reasons: [] };
  const professionalReasons = [
    ...(fit.familyUnitedOnOneSolution === 'no' ? ['familyUnitedOnOneSolution'] : []),
    ...(fit.canExecuteBasicsWithoutTutorial === 'no' ? ['canExecuteBasicsWithoutTutorial'] : []),
  ];
  if (professionalReasons.length) return { outcome: 'professional', reasons: professionalReasons };
  if (fit.familyUnitedOnOneSolution !== 'yes' || fit.canExecuteBasicsWithoutTutorial !== 'yes') {
    return { outcome: 'incomplete', reasons: [] };
  }
  return { outcome: 'pass', reasons: [] };
}

export function addDiyTeamMember(
  plan: DiyInterventionPlan,
  seed?: Partial<DiyTeamMember> & { id?: string },
  now = new Date().toISOString(),
): DiyInterventionPlan {
  if (plan.team.length >= DIY_TEAM_LIMIT) return plan;
  const generatedId = `member-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const id = seed?.id && safeTeamMemberId(seed.id) ? seed.id : generatedId;
  if (plan.team.some((member) => member.id === id)) return plan;
  const member: DiyTeamMember = {
    id, name: capTeamText(seed?.name ?? ''), relationship: capTeamText(seed?.relationship ?? ''), role: seed?.role ?? '',
    activelyUsing: seed?.activelyUsing ?? null, offersCompetingPlan: seed?.offersCompetingPlan ?? null,
    isChild: seed?.isChild ?? null, aligned: seed?.aligned ?? null,
  };
  return { ...plan, team: [...plan.team, member], updatedAt: now };
}

export function updateDiyTeamMember(
  plan: DiyInterventionPlan,
  id: string,
  patch: Partial<Omit<DiyTeamMember, 'id'>>,
  now = new Date().toISOString(),
): DiyInterventionPlan {
  const safePatch = {
    ...patch,
    ...(patch.name !== undefined ? { name: capTeamText(patch.name) } : {}),
    ...(patch.relationship !== undefined ? { relationship: capTeamText(patch.relationship) } : {}),
  };
  return { ...plan, team: plan.team.map((member) => member.id === id ? { ...member, ...safePatch } : member), updatedAt: now };
}

export function removeDiyTeamMember(plan: DiyInterventionPlan, id: string, now = new Date().toISOString()): DiyInterventionPlan {
  const letters = { ...plan.letters };
  delete letters[id];
  return {
    ...plan,
    team: plan.team.filter((member) => member.id !== id),
    undercutter: plan.undercutter.memberId === id ? { answer: '', memberId: '', agreesToSolutionAndLeaveTime: null } : plan.undercutter,
    letters,
    rehearsal: {
      ...plan.rehearsal,
      facilitatorId: plan.rehearsal.facilitatorId === id ? '' : plan.rehearsal.facilitatorId,
      debateHolderId: plan.rehearsal.debateHolderId === id ? '' : plan.rehearsal.debateHolderId,
      speakerOrder: plan.rehearsal.speakerOrder.filter((memberId) => memberId !== id),
    },
    updatedAt: now,
  };
}

export function updateDiyPlan(plan: DiyInterventionPlan, patch: Partial<DiyInterventionPlan>, now = new Date().toISOString()): DiyInterventionPlan {
  const next: DiyInterventionPlan = { ...plan, ...patch, updatedAt: now };
  if (patch.care) next.care = { ...patch.care, whyThisLevel: cap(patch.care.whyThisLevel) };
  if (patch.interventionDate !== undefined) next.interventionDate = cap(patch.interventionDate, 10);
  if (patch.unity) next.unity = {
    ...patch.unity,
    yesPlan: cap(patch.unity.yesPlan), plannedNo: cap(patch.unity.plannedNo),
    plannedNoStartDate: cap(patch.unity.plannedNoStartDate, 10), nextConversationDate: cap(patch.unity.nextConversationDate, 10),
  };
  if (patch.ama) next.ama = { ...patch.ama, note: cap(patch.ama.note) };
  return next;
}

export function blankDiyLetter(): DiyLetter { return { love: '', facts: '', request: '', boundary: '', complete: false, solutionKey: '' }; }

export function updateDiyLetter(
  plan: DiyInterventionPlan,
  memberId: string,
  patch: Partial<DiyLetter>,
  now = new Date().toISOString(),
): DiyInterventionPlan {
  const current = plan.letters[memberId] ?? blankDiyLetter();
  const next = {
    ...current,
    ...patch,
    ...(patch.love !== undefined ? { love: cap(patch.love, DIY_LETTER_SECTION_LIMIT) } : {}),
    ...(patch.facts !== undefined ? { facts: cap(patch.facts, DIY_LETTER_SECTION_LIMIT) } : {}),
    ...(patch.request !== undefined ? { request: cap(patch.request, DIY_LETTER_SECTION_LIMIT) } : {}),
    ...(patch.boundary !== undefined ? { boundary: cap(patch.boundary, DIY_LETTER_SECTION_LIMIT) } : {}),
  };
  return { ...plan, letters: { ...plan.letters, [memberId]: next }, updatedAt: now };
}

type StageResult = { ready: boolean; missing: string[] };
function stage(missing: string[]): StageResult { return { ready: missing.length === 0, missing }; }

function careStage(plan: DiyInterventionPlan): StageResult {
  const missing: string[] = [];
  if (!plan.care.indicatedLevel) missing.push('indicatedLevel');
  if (!plan.care.whyThisLevel.trim()) missing.push('whyThisLevel');
  if (!plan.care.planLevel) missing.push('planLevel');
  if (plan.care.indicatedLevel && plan.care.planLevel !== plan.care.indicatedLevel) missing.push('planMustMatchIndicatedLevel');
  return stage(missing);
}

function programStage(plan: DiyInterventionPlan, tap: DiyTapSnapshot, now: Date): StageResult {
  const missing: string[] = [];
  if (!tap.hydrated) missing.push('tapHydration');
  if (tap.saveState !== 'saved') missing.push('tapSaved');
  if (!tap.logisticsReady) missing.push('tapLogistics');
  if (!tap.logisticsFingerprint) missing.push('tapLogisticsFingerprint');
  if (!tap.revision) missing.push('tapRevision');
  if (!tap.programName.trim()) missing.push('programName');
  if (!tap.admissionsContactName.trim()) missing.push('admissionsContactName');
  if (!validPhone(tap.admissionsPhone)) missing.push('admissionsPhone');
  if (!validDate(plan.interventionDate)) missing.push('interventionDate');
  if (!validDate(tap.bedConfirmedFor) || tap.bedConfirmedFor !== plan.interventionDate) missing.push('bedForInterventionDate');
  if (!tap.bedConfirmationWindow.trim()) missing.push('bedConfirmationWindow');
  if (!tap.bedConfirmedBy.trim()) missing.push('bedConfirmedBy');
  const reconfirmedDate = localDateOf(tap.bedReconfirmedAt);
  const reconfirmed = tap.bedReconfirmedAt ? new Date(tap.bedReconfirmedAt) : null;
  if (!reconfirmedDate || !reconfirmed || reconfirmed.getTime() > now.getTime() || (reconfirmedDate !== plan.interventionDate && reconfirmedDate !== previousDate(plan.interventionDate))) missing.push('bedReconfirmedAt');
  const departure = tap.departureAt ? new Date(tap.departureAt) : null;
  if (localDateOf(tap.departureAt) !== plan.interventionDate || !departure || departure.getTime() <= now.getTime()) missing.push('leaveTime');
  return stage(missing);
}

function teamStage(plan: DiyInterventionPlan): StageResult {
  const missing: string[] = [];
  if (!plan.team.length) missing.push('team');
  for (const member of plan.team) {
    if (!member.name.trim() || !member.relationship.trim() || !member.role) missing.push(`member.${member.id}.identity`);
    if (member.activelyUsing === null || member.offersCompetingPlan === null || member.isChild === null) missing.push(`member.${member.id}.questions`);
    if (member.activelyUsing) missing.push(`member.${member.id}.activelyUsing`);
    const inRoom = member.role === 'speaker' || member.role === 'silent_support';
    if (inRoom && member.isChild) missing.push(`member.${member.id}.childInRoom`);
    if (inRoom && member.offersCompetingPlan) missing.push(`member.${member.id}.competingPlan`);
  }
  if (!plan.undercutter.answer) missing.push('undercutterAnswer');
  if (plan.undercutter.answer === 'named') {
    const member = plan.team.find((row) => row.id === plan.undercutter.memberId);
    if (!member) missing.push('undercutterMember');
    if (plan.undercutter.agreesToSolutionAndLeaveTime === null) missing.push('undercutterAgreement');
    if (plan.undercutter.agreesToSolutionAndLeaveTime === false) missing.push('undercutterNotAligned');
    if (member && !plan.undercutter.agreesToSolutionAndLeaveTime && (member.role === 'speaker' || member.role === 'silent_support')) {
      missing.push('undercutterCannotBeInRoom');
    }
  }
  return stage(missing);
}

function unityStage(plan: DiyInterventionPlan, solutionKey: string): StageResult {
  const missing: string[] = [];
  if (!plan.unity.solutionConfirmed) missing.push('solutionConfirmed');
  if (!solutionKey || plan.unity.solutionKey !== solutionKey) missing.push('solutionChanged');
  if (!plan.unity.yesPlan.trim()) missing.push('yesPlan');
  if (!plan.unity.plannedNo.trim()) missing.push('plannedNo');
  if (!validDate(plan.unity.plannedNoStartDate) || plan.unity.plannedNoStartDate !== plan.interventionDate) missing.push('plannedNoStartDate');
  if (!validDate(plan.unity.nextConversationDate) || (validDate(plan.interventionDate) && plan.unity.nextConversationDate <= plan.interventionDate)) missing.push('nextConversationDate');
  for (const member of plan.team.filter((row) => row.role !== 'not_in_room')) {
    if (member.aligned !== true) missing.push(`member.${member.id}.alignment`);
  }
  return stage(missing);
}

function lettersStage(plan: DiyInterventionPlan, solutionKey: string): StageResult {
  const missing: string[] = [];
  for (const speaker of plan.team.filter((member) => member.role === 'speaker')) {
    const letter = plan.letters[speaker.id];
    if (!letter || !letter.complete || letter.solutionKey !== solutionKey || !letter.love.trim() || !letter.facts.trim() || !letter.request.trim() || !letter.boundary.trim()) {
      missing.push(`letter.${speaker.id}`);
    }
  }
  if (!plan.team.some((member) => member.role === 'speaker')) missing.push('speaker');
  return stage(missing);
}

function rehearsalStage(plan: DiyInterventionPlan, solutionKey: string): StageResult {
  const missing: string[] = [];
  const speakers = plan.team.filter((member) => member.role === 'speaker').map((member) => member.id).sort();
  const order = [...new Set(plan.rehearsal.speakerOrder)].sort();
  const inRoomEligible = (id: string) => plan.team.some((member) => member.id === id && member.aligned === true && (member.role === 'speaker' || member.role === 'silent_support'));
  if (!inRoomEligible(plan.rehearsal.facilitatorId)) missing.push('facilitator');
  if (!inRoomEligible(plan.rehearsal.debateHolderId)) missing.push('debateHolder');
  if (speakers.length !== order.length || speakers.some((id, index) => id !== order[index])) missing.push('speakerOrder');
  if (!plan.rehearsal.durationMinutes || plan.rehearsal.durationMinutes < 10 || plan.rehearsal.durationMinutes > 90) missing.push('duration');
  if (!plan.rehearsal.makeAskOnce) missing.push('makeAskOnce');
  if (!plan.rehearsal.stopDebate) missing.push('stopDebate');
  if (!plan.rehearsal.noStacking) missing.push('noStacking');
  if (plan.rehearsal.professionalStagingRequested) missing.push('professionalStagingRequested');
  if (!plan.rehearsal.complete) missing.push('complete');
  if (!solutionKey || plan.rehearsal.solutionKey !== solutionKey) missing.push('solutionChanged');
  return stage(missing);
}

function executeStage(plan: DiyInterventionPlan, solutionKey: string): StageResult {
  const missing: string[] = [];
  if (!plan.ama.written) missing.push('amaWritten');
  if (!plan.ama.familyIsNotRide) missing.push('familyIsNotRide');
  if (!plan.ama.houseDoesNotOpen) missing.push('houseDoesNotOpen');
  if (!plan.ama.moneyDoesNotMove) missing.push('moneyDoesNotMove');
  if (!plan.ama.callFacilityFirst) missing.push('callFacilityFirst');
  if (!plan.ama.useTapBackup) missing.push('useTapBackup');
  if (!plan.ama.note.trim()) missing.push('amaNote');
  if (!solutionKey || plan.ama.solutionKey !== solutionKey) missing.push('solutionChanged');
  return stage(missing);
}

export function diyInterventionProgress(plan: DiyInterventionPlan, tap: DiyTapSnapshot, now = new Date()) {
  const fitResult = diyFitResult(plan.fit);
  const solutionKey = diySolutionKey(plan, tap);
  const stages = {
    fit: stage(fitResult.outcome === 'pass' ? [] : [`fit.${fitResult.outcome}`]),
    care: careStage(plan),
    program: programStage(plan, tap, now),
    team: teamStage(plan),
    unity: unityStage(plan, solutionKey),
    letters: lettersStage(plan, solutionKey),
    rehearsal: rehearsalStage(plan, solutionKey),
    execute: executeStage(plan, solutionKey),
  };
  const completed = Object.values(stages).filter((item) => item.ready).length;
  return { stages, completed, total: Object.keys(stages).length, ready: completed === Object.keys(stages).length };
}

export function diyStageAccess(plan: DiyInterventionPlan, tap: DiyTapSnapshot, now = new Date()) {
  const progress = diyInterventionProgress(plan, tap, now);
  const fit = progress.stages.fit.ready;
  const care = fit;
  const program = care && progress.stages.care.ready;
  const team = program && progress.stages.program.ready;
  const unity = team && progress.stages.team.ready;
  const letters = unity && progress.stages.unity.ready;
  const rehearsal = letters && progress.stages.letters.ready;
  // Expired departure time removes current readiness, but a fully attested plan
  // must retain access to its day-of outcome record. All solution-bound stages
  // still have to match the current TAP facts, and TAP must remain hydrated/saved.
  const execute = tap.hydrated
    && tap.saveState === 'saved'
    && tap.dayOfRecordingReady
    && progress.stages.fit.ready
    && progress.stages.care.ready
    && progress.stages.team.ready
    && progress.stages.unity.ready
    && progress.stages.letters.ready
    && progress.stages.rehearsal.ready;
  return { fit: true, care, program, team, unity, letters, rehearsal, execute };
}
