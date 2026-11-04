export const HOLIDAY_DETAIL_LIMIT = 300;
/** Characters a member can type per answer: one or two sentences. */
export const HOLIDAY_INPUT_MAX_LENGTH = 200;
export const HOLIDAY_PROTECTED_BYTE_LIMIT = 1800;

export const HOLIDAY_INVITATIONS = ['invited', 'separateVisit', 'notThisYear'] as const;
export type HolidayInvitation = typeof HOLIDAY_INVITATIONS[number];

export const HOLIDAY_COMMITMENTS = [
  'hostsAgree',
  'noCash',
  'secureAlcoholMeds',
  'noTableDebate',
  'followPlan',
  'naloxone',
  'supportCall',
  'ownDay',
] as const;

export type HolidayCommitmentId = typeof HOLIDAY_COMMITMENTS[number];
export type HolidayCommitments = Record<HolidayCommitmentId, boolean>;

export type HolidayPlan = {
  occasion: string;
  /** '' until the family decides. */
  invitation: HolidayInvitation | '';
  terms: string;
  ifTermsBreak: string;
  relatives: string;
  ownExit: string;
  kids: string;
  gift: string;
  commitments: HolidayCommitments;
  updatedAt: string | null;
};

export const HOLIDAY_TEXT_KEYS = ['occasion', 'terms', 'ifTermsBreak', 'relatives', 'ownExit', 'kids', 'gift'] as const;
export type HolidayTextKey = typeof HOLIDAY_TEXT_KEYS[number];
/** Kids and gift are optional: not every family has either at the table. */
const REQUIRED_TEXT: readonly HolidayTextKey[] = ['occasion', 'terms', 'ifTermsBreak', 'relatives', 'ownExit'];

const EMPTY_COMMITMENTS = Object.fromEntries(
  HOLIDAY_COMMITMENTS.map((id) => [id, false]),
) as HolidayCommitments;

export function defaultHolidayPlan(): HolidayPlan {
  return {
    occasion: '',
    invitation: '',
    terms: '',
    ifTermsBreak: '',
    relatives: '',
    ownExit: '',
    kids: '',
    gift: '',
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
    if (bytes + characterBytes > HOLIDAY_DETAIL_LIMIT) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
}

function isInvitation(value: unknown): value is HolidayInvitation {
  return typeof value === 'string' && (HOLIDAY_INVITATIONS as readonly string[]).includes(value);
}

export function holidayPlanProtectedByteLength(plan: HolidayPlan): number {
  return utf8ByteLength(JSON.stringify(plan));
}

function fitPlanToProtectedBudget(plan: HolidayPlan, changedKeys: (keyof HolidayPlan)[]): HolidayPlan {
  if (holidayPlanProtectedByteLength(plan) <= HOLIDAY_PROTECTED_BYTE_LIMIT) return plan;
  const changedTextKeys = changedKeys.filter((key): key is HolidayTextKey =>
    (HOLIDAY_TEXT_KEYS as readonly string[]).includes(key));
  const next = { ...plan };
  for (const key of changedTextKeys.reverse()) {
    const characters = Array.from(next[key]);
    while (characters.length > 0 && holidayPlanProtectedByteLength(next) > HOLIDAY_PROTECTED_BYTE_LIMIT) {
      characters.pop();
      next[key] = characters.join('');
    }
  }
  if (holidayPlanProtectedByteLength(next) > HOLIDAY_PROTECTED_BYTE_LIMIT) {
    throw new Error('protected_holiday_value_too_large');
  }
  return next;
}

export function updateHolidayPlan(
  plan: HolidayPlan,
  patch: Partial<Omit<HolidayPlan, 'updatedAt'>>,
  now = new Date().toISOString(),
): HolidayPlan {
  const textPatch = Object.fromEntries(
    Object.entries(patch)
      .filter(([key]) => (HOLIDAY_TEXT_KEYS as readonly string[]).includes(key))
      .map(([key, value]) => [key, typeof value === 'string' ? cap(value) : '']),
  ) as Partial<HolidayPlan>;
  const invitation = patch.invitation === undefined
    ? plan.invitation
    : isInvitation(patch.invitation) ? patch.invitation : '';
  const commitments = patch.commitments
    ? Object.fromEntries(HOLIDAY_COMMITMENTS.map((id) => [id, patch.commitments?.[id] === true])) as HolidayCommitments
    : plan.commitments;
  const next = { ...plan, ...textPatch, invitation, commitments, updatedAt: now };
  return fitPlanToProtectedBudget(next, Object.keys(patch) as (keyof HolidayPlan)[]);
}

export function parseHolidayPlan(raw: string | null): HolidayPlan {
  if (raw === null) return defaultHolidayPlan();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('protected_holiday_invalid_json');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('protected_holiday_invalid_shape');
  }
  const source = parsed as Record<string, unknown>;
  const requiredFields = [...HOLIDAY_TEXT_KEYS, 'invitation', 'commitments', 'updatedAt'] as const;
  const missingField = requiredFields.find((key) => !Object.prototype.hasOwnProperty.call(source, key));
  if (missingField) throw new Error(`protected_holiday_missing_field:${missingField}`);
  const invalidText = HOLIDAY_TEXT_KEYS.find((key) => typeof source[key] !== 'string');
  if (invalidText) throw new Error(`protected_holiday_invalid_field:${invalidText}`);
  if (source.invitation !== '' && !isInvitation(source.invitation)) {
    throw new Error('protected_holiday_invalid_invitation');
  }
  if (source.updatedAt !== null && (typeof source.updatedAt !== 'string' || !Number.isFinite(new Date(source.updatedAt).getTime()))) {
    throw new Error('protected_holiday_invalid_updated_at');
  }
  if (!source.commitments || typeof source.commitments !== 'object' || Array.isArray(source.commitments)) {
    throw new Error('protected_holiday_invalid_commitments');
  }
  const commitmentSource = source.commitments as Record<string, unknown>;
  const missingCommitment = HOLIDAY_COMMITMENTS.find((id) => typeof commitmentSource[id] !== 'boolean');
  if (missingCommitment) throw new Error(`protected_holiday_missing_commitment:${missingCommitment}`);
  const text = Object.fromEntries(
    HOLIDAY_TEXT_KEYS.map((key) => [key, cap(source[key] as string)]),
  ) as Record<HolidayTextKey, string>;
  const plan: HolidayPlan = {
    ...text,
    invitation: isInvitation(source.invitation) ? source.invitation : '',
    commitments: Object.fromEntries(
      HOLIDAY_COMMITMENTS.map((id) => [id, commitmentSource[id] === true]),
    ) as HolidayCommitments,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
  };
  if (holidayPlanProtectedByteLength(plan) > HOLIDAY_PROTECTED_BYTE_LIMIT) {
    throw new Error('protected_holiday_value_too_large');
  }
  return plan;
}

export function holidayPlanProgress(plan: HolidayPlan): {
  ready: boolean;
  completed: number;
  total: number;
  missing: string[];
} {
  const missing: string[] = [];
  if (!plan.invitation) missing.push('invitation');
  for (const key of REQUIRED_TEXT) {
    if (!plan[key].trim()) missing.push(key);
  }
  for (const id of HOLIDAY_COMMITMENTS) {
    if (!plan.commitments[id]) missing.push(`commitments.${id}`);
  }
  const total = 1 + REQUIRED_TEXT.length + HOLIDAY_COMMITMENTS.length;
  return { ready: missing.length === 0, completed: total - missing.length, total, missing };
}

/** True once she has written or chosen anything. */
export function holidayPlanStarted(plan: HolidayPlan): boolean {
  return plan.invitation !== ''
    || HOLIDAY_TEXT_KEYS.some((key) => plan[key].trim().length > 0)
    || HOLIDAY_COMMITMENTS.some((id) => plan.commitments[id]);
}

/**
 * The holiday season on her phone's calendar: November 1 through January 6
 * (Día de Reyes). January belongs to the season that began the November
 * before, so a dismissal in December still holds on New Year's Day.
 */
export function holidaySeason(now: Date): { active: boolean; season: string } {
  const month = now.getMonth();
  const year = now.getFullYear();
  if (month === 10 || month === 11) return { active: true, season: String(year) };
  if (month === 0 && now.getDate() <= 6) return { active: true, season: String(year - 1) };
  return { active: false, season: String(month === 0 ? year - 1 : year) };
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The plan as plain text for the share sheet: only what she has written. */
export function holidayPlanShareText(plan: HolidayPlan, t: Translate): string {
  const lines = [t('shareHeading')];
  const add = (label: string, value: string) => {
    if (value.trim()) lines.push('', label, value.trim());
  };
  add(t('fields.occasion'), plan.occasion);
  if (plan.invitation) lines.push('', t('invitationLabel'), t(`invitations.${plan.invitation}.label`));
  if (plan.invitation) add(t(`invitations.${plan.invitation}.termsLabel`), plan.terms);
  add(t('fields.ifTermsBreak'), plan.ifTermsBreak);
  add(t('fields.relatives'), plan.relatives);
  add(t('fields.kids'), plan.kids);
  add(t('fields.gift'), plan.gift);
  const agreed = HOLIDAY_COMMITMENTS.filter((id) => plan.commitments[id]);
  if (agreed.length) {
    lines.push('', t('sectionCommitments'));
    for (const id of agreed) lines.push(`• ${t(`commitments.${id}`)}`);
  }
  return lines.join('\n');
}
