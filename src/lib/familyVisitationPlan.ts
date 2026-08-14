export const VISITATION_DETAIL_LIMIT = 350;

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

function cap(value: string): string {
  return value.slice(0, VISITATION_DETAIL_LIMIT);
}

function safeString(value: unknown): string {
  return typeof value === 'string' ? cap(value) : '';
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
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
  return { ...plan, ...textPatch, commitments, updatedAt: now };
}

export function parseFamilyVisitationPlan(raw: string | null): FamilyVisitationPlan {
  if (!raw) return defaultFamilyVisitationPlan();
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
  if (!source.commitments || typeof source.commitments !== 'object' || Array.isArray(source.commitments)) {
    throw new Error('protected_visitation_invalid_commitments');
  }
  const commitmentSource = source.commitments as Record<string, unknown>;
  const missingCommitment = VISITATION_COMMITMENTS.find((id) => typeof commitmentSource[id] !== 'boolean');
  if (missingCommitment) throw new Error(`protected_visitation_missing_commitment:${missingCommitment}`);
  return {
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
}

export function familyVisitationProgress(plan: FamilyVisitationPlan): {
  ready: boolean;
  completed: number;
  total: number;
  missing: string[];
} {
  const missing: string[] = [];
  const requiredText = ['facility', 'arrivalTime', 'leaveTime', 'attendees', 'carePackage', 'parkingLotExitPlan'] as const;
  for (const key of requiredText) {
    if (!plan[key].trim()) missing.push(key);
  }
  if (!validDate(plan.visitDate)) missing.push('visitDate');
  for (const id of VISITATION_COMMITMENTS) {
    if (!plan.commitments[id]) missing.push(`commitments.${id}`);
  }
  const total = requiredText.length + 1 + VISITATION_COMMITMENTS.length;
  return { ready: missing.length === 0, completed: total - missing.length, total, missing };
}
