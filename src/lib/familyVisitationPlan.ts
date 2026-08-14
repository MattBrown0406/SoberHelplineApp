export const VISITATION_DETAIL_LIMIT = 350;
export const VISITATION_PROTECTED_BYTE_LIMIT = 1800;

export const VISITATION_COMMITMENTS = [
  'writtenBeforeDrive',
  'noCash',
  'noRoomReady',
  'noOutsideNegotiation',
  'backProgram',
  'leaveOnTime',
  'approvedCarePackage',
  'parkingLotExit',
] as const;

export type VisitationCommitmentId = typeof VISITATION_COMMITMENTS[number];
export type VisitationCommitments = Record<VisitationCommitmentId, boolean>;

export type FamilyVisitationPlan = {
  facility: string;
  visitDate: string;
  arrivalTime: string;
  leaveTime: string;
  attendees: string;
  carePackage: string;
  parkingLotExitPlan: string;
  commitments: VisitationCommitments;
  updatedAt: string | null;
};

const EMPTY_COMMITMENTS = Object.fromEntries(
  VISITATION_COMMITMENTS.map((id) => [id, false]),
) as VisitationCommitments;

export function defaultFamilyVisitationPlan(): FamilyVisitationPlan {
  return {
    facility: '',
    visitDate: '',
    arrivalTime: '',
    leaveTime: '',
    attendees: '',
    carePackage: '',
    parkingLotExitPlan: '',
    commitments: { ...EMPTY_COMMITMENTS },
    updatedAt: null,
  };
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function cap(value: string): string {
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const characterBytes = utf8ByteLength(character);
    if (bytes + characterBytes > VISITATION_DETAIL_LIMIT) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? cap(value) : '';
}

export function familyVisitationProtectedByteLength(plan: FamilyVisitationPlan): number {
  return utf8ByteLength(JSON.stringify(plan));
}

const PLAN_TEXT_KEYS = ['facility', 'visitDate', 'arrivalTime', 'leaveTime', 'attendees', 'carePackage', 'parkingLotExitPlan'] as const;
type PlanTextKey = typeof PLAN_TEXT_KEYS[number];

function fitPlanToProtectedBudget(plan: FamilyVisitationPlan, changedKeys: (keyof FamilyVisitationPlan)[]): FamilyVisitationPlan {
  if (familyVisitationProtectedByteLength(plan) <= VISITATION_PROTECTED_BYTE_LIMIT) return plan;
  const changedTextKeys = changedKeys.filter((key): key is PlanTextKey =>
    PLAN_TEXT_KEYS.includes(key as PlanTextKey));
  const next = { ...plan };
  for (const key of changedTextKeys.reverse()) {
    const characters = Array.from(next[key]);
    while (characters.length > 0 && familyVisitationProtectedByteLength(next) > VISITATION_PROTECTED_BYTE_LIMIT) {
      characters.pop();
      next[key] = characters.join('');
    }
  }
  if (familyVisitationProtectedByteLength(next) > VISITATION_PROTECTED_BYTE_LIMIT) {
    throw new Error('protected_visitation_value_too_large');
  }
  return next;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function timeMinutes(value: string): number | null {
  const normalized = value.trim().toUpperCase().replace(/[.\s]/g, '');
  const twelveHour = normalized.match(/^(\d{1,2})(?::([0-5]\d))?(AM|PM)$/);
  if (twelveHour) {
    const hour = Number(twelveHour[1]);
    if (hour < 1 || hour > 12) return null;
    const minute = Number(twelveHour[2] ?? '0');
    return (hour % 12) * 60 + minute + (twelveHour[3] === 'PM' ? 720 : 0);
  }
  const twentyFourHour = normalized.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  return twentyFourHour ? Number(twentyFourHour[1]) * 60 + Number(twentyFourHour[2]) : null;
}

export function updateFamilyVisitationPlan(
  plan: FamilyVisitationPlan,
  patch: Partial<Omit<FamilyVisitationPlan, 'updatedAt'>>,
  now = new Date().toISOString(),
): FamilyVisitationPlan {
  const textPatch = Object.fromEntries(
    Object.entries(patch).map(([key, value]) => [key, typeof value === 'string' ? cap(value) : value]),
  ) as Partial<FamilyVisitationPlan>;
  const commitments = patch.commitments
    ? Object.fromEntries(VISITATION_COMMITMENTS.map((id) => [id, patch.commitments?.[id] === true])) as VisitationCommitments
    : plan.commitments;
  const next = { ...plan, ...textPatch, commitments, updatedAt: now };
  return fitPlanToProtectedBudget(next, Object.keys(patch) as (keyof FamilyVisitationPlan)[]);
}

export function parseFamilyVisitationPlan(raw: string | null): FamilyVisitationPlan {
  if (raw === null) return defaultFamilyVisitationPlan();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('protected_visitation_invalid_json');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('protected_visitation_invalid_shape');
  }
  const source = parsed as Record<string, unknown>;
  const requiredFields = ['facility', 'visitDate', 'arrivalTime', 'leaveTime', 'attendees', 'carePackage', 'parkingLotExitPlan', 'commitments', 'updatedAt'] as const;
  const missingField = requiredFields.find((key) => !Object.prototype.hasOwnProperty.call(source, key));
  if (missingField) throw new Error(`protected_visitation_missing_field:${missingField}`);
  const textFields = ['facility', 'visitDate', 'arrivalTime', 'leaveTime', 'attendees', 'carePackage', 'parkingLotExitPlan'] as const;
  const invalidText = textFields.find((key) => typeof source[key] !== 'string');
  if (invalidText) throw new Error(`protected_visitation_invalid_field:${invalidText}`);
  if (source.updatedAt !== null && (typeof source.updatedAt !== 'string' || !Number.isFinite(new Date(source.updatedAt).getTime()))) {
    throw new Error('protected_visitation_invalid_updated_at');
  }
  if (!source.commitments || typeof source.commitments !== 'object' || Array.isArray(source.commitments)) {
    throw new Error('protected_visitation_invalid_commitments');
  }
  const commitmentSource = source.commitments as Record<string, unknown>;
  const missingCommitment = VISITATION_COMMITMENTS.find((id) => typeof commitmentSource[id] !== 'boolean');
  if (missingCommitment) throw new Error(`protected_visitation_missing_commitment:${missingCommitment}`);
  const plan: FamilyVisitationPlan = {
    facility: safeString(source.facility),
    visitDate: safeString(source.visitDate),
    arrivalTime: safeString(source.arrivalTime),
    leaveTime: safeString(source.leaveTime),
    attendees: safeString(source.attendees),
    carePackage: safeString(source.carePackage),
    parkingLotExitPlan: safeString(source.parkingLotExitPlan),
    commitments: Object.fromEntries(
      VISITATION_COMMITMENTS.map((id) => [id, commitmentSource[id] === true]),
    ) as VisitationCommitments,
    updatedAt: typeof source.updatedAt === 'string' && Number.isFinite(new Date(source.updatedAt).getTime())
      ? source.updatedAt : null,
  };
  if (familyVisitationProtectedByteLength(plan) > VISITATION_PROTECTED_BYTE_LIMIT) {
    throw new Error('protected_visitation_value_too_large');
  }
  return plan;
}

export function familyVisitationProgress(plan: FamilyVisitationPlan): {
  ready: boolean;
  completed: number;
  total: number;
  missing: string[];
} {
  const missing: string[] = [];
  const requiredText = ['facility', 'attendees', 'carePackage', 'parkingLotExitPlan'] as const;
  for (const key of requiredText) {
    if (!plan[key].trim()) missing.push(key);
  }
  if (!validDate(plan.visitDate)) missing.push('visitDate');
  const arrivalMinutes = timeMinutes(plan.arrivalTime);
  const leaveMinutes = timeMinutes(plan.leaveTime);
  if (arrivalMinutes === null) missing.push('arrivalTime');
  if (leaveMinutes === null) missing.push('leaveTime');
  if (arrivalMinutes !== null && leaveMinutes !== null && leaveMinutes <= arrivalMinutes) missing.push('leaveTimeOrder');
  for (const id of VISITATION_COMMITMENTS) {
    if (!plan.commitments[id]) missing.push(`commitments.${id}`);
  }
  const total = requiredText.length + 3 + VISITATION_COMMITMENTS.length;
  return { ready: missing.length === 0, completed: total - missing.length, total, missing };
}
