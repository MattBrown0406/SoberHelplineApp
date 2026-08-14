export type HomecomingAgeBand = '' | 'under_18' | 'adult';
export type HomecomingGender = '' | 'woman' | 'man' | 'nonbinary' | 'prefer_not_to_say';
export type HomecomingHousingType = '' | 'family_home' | 'sober_living' | 'own_home' | 'partner' | 'friend' | 'other';
export type HomecomingStatus = 'not_started' | 'working' | 'confirmed' | 'not_applicable';
export type NamedStatus = '' | 'named' | 'none_named';

export type HomecomingItemId =
  | 'day0_pickup'
  | 'day0_access'
  | 'day0_first_night'
  | 'family_session'
  | 'outpatient_calendar'
  | 'meetings_calendar'
  | 'irritability_sentence'
  | 'days1_3_privileges'
  | 'first_weekend'
  | 'privilege_schedule'
  | 'employment_school'
  | 'day7_review';

export type HomecomingItemDefinition = {
  id: HomecomingItemId;
  category: 'day0' | 'days1_3' | 'days4_7';
};

export type HomecomingItemState = {
  status: HomecomingStatus;
  person: string;
  place: string;
  time: string;
  backup: string;
  details: string;
  updatedAt: string | null;
};

export type HomecomingIdentity = {
  preferredName: string;
  ageBand: HomecomingAgeBand;
  exactAge: string;
  gender: HomecomingGender;
};

export type HomecomingDischarge = {
  facilityName: string;
  dischargeDate: string;
  level: '' | 'detox' | 'residential' | 'php' | 'iop' | 'outpatient' | 'other';
  levelOther: string;
  housingType: HomecomingHousingType;
  housingDetails: string;
  receivingAdult: string;
  adultReturnHomeConfirmed: boolean;
  adultReturnHomeQuote: string;
  soberLivingStatus: NamedStatus;
  soberLivingName: string;
  soberLivingCity: string;
  soberLivingPhone: string;
  soberLivingStartDate: string;
  soberLivingRules: string;
  outpatientStatus: NamedStatus;
  outpatientName: string;
  outpatientStartDate: string;
  outpatientSchedule: string;
  outpatientTransport: string;
  fellowship: '' | 'aa' | 'na' | 'ca' | 'smart' | 'refuge' | 'other';
  fellowshipOther: string;
  meetingsKnown: '' | 'yes' | 'no';
  firstMeetings: string;
  meetingPlace: string;
  backupMeeting: string;
  employmentStatus: '' | 'work' | 'school' | 'not_yet' | 'disabled' | 'unknown';
  employmentDetails: string;
  employmentHelper: string;
  aftercareStatus: NamedStatus;
  aftercareName: string;
  aftercareContact: string;
  medicationStatus: '' | 'yes' | 'no';
  medicationListHolder: string;
  otherInstructions: string;
};

export type HomecomingWeekPlan = {
  identity: HomecomingIdentity;
  discharge: HomecomingDischarge;
  items: Record<HomecomingItemId, HomecomingItemState>;
  updatedAt: string | null;
};

export const HOMECOMING_FIELD_LIMIT = 180;
export const HOMECOMING_DETAIL_LIMIT = 350;

export const HOMECOMING_ITEMS: HomecomingItemDefinition[] = [
  { id: 'day0_pickup', category: 'day0' },
  { id: 'day0_access', category: 'day0' },
  { id: 'day0_first_night', category: 'day0' },
  { id: 'family_session', category: 'days1_3' },
  { id: 'outpatient_calendar', category: 'days1_3' },
  { id: 'meetings_calendar', category: 'days1_3' },
  { id: 'irritability_sentence', category: 'days1_3' },
  { id: 'days1_3_privileges', category: 'days1_3' },
  { id: 'first_weekend', category: 'days4_7' },
  { id: 'privilege_schedule', category: 'days4_7' },
  { id: 'employment_school', category: 'days4_7' },
  { id: 'day7_review', category: 'days4_7' },
];

const EMPTY_IDENTITY: HomecomingIdentity = {
  preferredName: '', ageBand: '', exactAge: '', gender: '',
};

const EMPTY_DISCHARGE: HomecomingDischarge = {
  facilityName: '', dischargeDate: '', level: '', levelOther: '',
  housingType: '', housingDetails: '', receivingAdult: '',
  adultReturnHomeConfirmed: false, adultReturnHomeQuote: '',
  soberLivingStatus: '', soberLivingName: '', soberLivingCity: '', soberLivingPhone: '',
  soberLivingStartDate: '', soberLivingRules: '',
  outpatientStatus: '', outpatientName: '', outpatientStartDate: '', outpatientSchedule: '', outpatientTransport: '',
  fellowship: '', fellowshipOther: '', meetingsKnown: '', firstMeetings: '', meetingPlace: '', backupMeeting: '',
  employmentStatus: '', employmentDetails: '', employmentHelper: '',
  aftercareStatus: '', aftercareName: '', aftercareContact: '',
  medicationStatus: '', medicationListHolder: '', otherInstructions: '',
};

function emptyItem(): HomecomingItemState {
  return { status: 'not_started', person: '', place: '', time: '', backup: '', details: '', updatedAt: null };
}

export function defaultHomecomingWeekPlan(): HomecomingWeekPlan {
  return {
    identity: { ...EMPTY_IDENTITY },
    discharge: { ...EMPTY_DISCHARGE },
    items: Object.fromEntries(HOMECOMING_ITEMS.map(({ id }) => [id, emptyItem()])) as Record<HomecomingItemId, HomecomingItemState>,
    updatedAt: null,
  };
}

function has(value: string): boolean { return value.trim().length > 0; }
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function parentHomeWords(value: string): boolean {
  return /\b(mom|mum|mother|dad|father|parents?|parental|family home|old room|mamá|mama|madre|papá|papa|padre|padres|casa familiar)\b/i.test(value);
}

export function homecomingHousingOptions(plan: HomecomingWeekPlan): HomecomingHousingType[] {
  if (plan.identity.ageBand === 'under_18') return ['family_home', 'other'];
  const options: HomecomingHousingType[] = ['sober_living', 'own_home', 'partner', 'friend', 'other'];
  if (plan.identity.ageBand === 'adult' && plan.discharge.adultReturnHomeConfirmed) options.push('family_home');
  return options;
}

export function dischargeReadiness(plan: HomecomingWeekPlan): {
  ready: boolean;
  housingBlocked: boolean;
  missing: string[];
} {
  const { identity, discharge } = plan;
  const missing: string[] = [];
  if (!has(identity.preferredName)) missing.push('identity.preferredName');
  if (!identity.ageBand) missing.push('identity.ageBand');
  if (!identity.gender) missing.push('identity.gender');
  const numericAge = identity.exactAge === '' ? null : Number(identity.exactAge);
  if (numericAge !== null && (!Number.isInteger(numericAge) || numericAge < 0 || numericAge > 120)) missing.push('identity.exactAge');
  if (numericAge !== null && identity.ageBand === 'adult' && numericAge < 18) missing.push('identity.ageConflict');
  if (numericAge !== null && identity.ageBand === 'under_18' && numericAge >= 18) missing.push('identity.ageConflict');

  if (!has(discharge.facilityName)) missing.push('discharge.facilityName');
  if (!validDate(discharge.dischargeDate)) missing.push('discharge.dischargeDate');
  if (!discharge.level) missing.push('discharge.level');
  if (discharge.level === 'other' && !has(discharge.levelOther)) missing.push('discharge.levelOther');
  if (!discharge.housingType) missing.push('discharge.housingType');
  if (!has(discharge.housingDetails)) missing.push('discharge.housingDetails');

  const adult = identity.ageBand === 'adult';
  const adultParentTypeBlocked = adult && discharge.housingType === 'family_home'
    && (!discharge.adultReturnHomeConfirmed || !has(discharge.adultReturnHomeQuote));
  const adultParentNotesBlocked = adult && !discharge.adultReturnHomeConfirmed && parentHomeWords(discharge.housingDetails);
  const housingBlocked = adultParentTypeBlocked || adultParentNotesBlocked;
  if (housingBlocked) missing.push('discharge.adultHousingRule');
  if (identity.ageBand === 'under_18' && !has(discharge.receivingAdult)) missing.push('discharge.receivingAdult');

  if (!discharge.soberLivingStatus) missing.push('discharge.soberLivingStatus');
  if (discharge.housingType === 'sober_living' && discharge.soberLivingStatus !== 'named') missing.push('discharge.soberLivingRequired');
  if (discharge.soberLivingStatus === 'named') {
    for (const key of ['soberLivingName', 'soberLivingCity', 'soberLivingPhone', 'soberLivingStartDate', 'soberLivingRules'] as const) {
      if (!has(discharge[key])) missing.push(`discharge.${key}`);
    }
  }
  if (!discharge.outpatientStatus) missing.push('discharge.outpatientStatus');
  if (discharge.outpatientStatus === 'named') {
    for (const key of ['outpatientName', 'outpatientStartDate', 'outpatientSchedule', 'outpatientTransport'] as const) {
      if (!has(discharge[key])) missing.push(`discharge.${key}`);
    }
  }
  if (!discharge.fellowship) missing.push('discharge.fellowship');
  if (discharge.fellowship === 'other' && !has(discharge.fellowshipOther)) missing.push('discharge.fellowshipOther');
  if (discharge.meetingsKnown !== 'yes') missing.push('discharge.meetingsKnown');
  for (const key of ['firstMeetings', 'meetingPlace', 'backupMeeting'] as const) {
    if (!has(discharge[key])) missing.push(`discharge.${key}`);
  }
  if (!discharge.employmentStatus) missing.push('discharge.employmentStatus');
  if ((discharge.employmentStatus === 'work' || discharge.employmentStatus === 'school') && !has(discharge.employmentDetails)) {
    missing.push('discharge.employmentDetails');
  }
  if (!has(discharge.employmentHelper)) missing.push('discharge.employmentHelper');
  if (!discharge.aftercareStatus) missing.push('discharge.aftercareStatus');
  if (discharge.aftercareStatus === 'named' && (!has(discharge.aftercareName) || !has(discharge.aftercareContact))) {
    missing.push('discharge.aftercareContact');
  }
  if (!discharge.medicationStatus) missing.push('discharge.medicationStatus');
  if (discharge.medicationStatus === 'yes' && !has(discharge.medicationListHolder)) missing.push('discharge.medicationListHolder');
  return { ready: missing.length === 0, housingBlocked, missing };
}

export function canHomecomingItemBeNotApplicable(plan: HomecomingWeekPlan, id: HomecomingItemId): boolean {
  if (id === 'employment_school') return plan.discharge.employmentStatus !== 'work' && plan.discharge.employmentStatus !== 'school';
  if (id === 'outpatient_calendar') return plan.discharge.outpatientStatus === 'none_named';
  return false;
}

export function isHomecomingItemComplete(plan: HomecomingWeekPlan, definition: HomecomingItemDefinition): boolean {
  const item = plan.items[definition.id];
  if (item.status === 'not_applicable') return canHomecomingItemBeNotApplicable(plan, definition.id) && has(item.details);
  return item.status === 'confirmed'
    && has(item.person) && has(item.place) && has(item.time) && has(item.backup) && has(item.details);
}

export function homecomingProgress(plan: HomecomingWeekPlan) {
  const dischargeReady = dischargeReadiness(plan).ready;
  const completed = HOMECOMING_ITEMS.filter((definition) => isHomecomingItemComplete(plan, definition)).length;
  const total = HOMECOMING_ITEMS.length;
  return {
    dischargeReady,
    completed,
    total,
    percentage: Math.round(((completed + (dischargeReady ? 1 : 0)) / (total + 1)) * 100),
    ready: dischargeReady && completed === total,
  };
}

export function homecomingFitKey(plan: HomecomingWeekPlan): string {
  const age = Number(plan.identity.exactAge);
  const youngAdult = plan.identity.ageBand === 'adult' && Number.isInteger(age) && age >= 18 && age <= 25;
  const ageKey = plan.identity.ageBand === 'under_18' ? 'youth' : youngAdult ? 'young_adult' : 'adult';
  const gender = plan.identity.gender || 'prefer_not_to_say';
  return `${ageKey}_${gender}`.replace('_prefer_not_to_say', '_neutral');
}

function cap(value: string, limit = HOMECOMING_FIELD_LIMIT): string { return value.slice(0, limit); }

export function updateHomecomingIdentity(
  plan: HomecomingWeekPlan,
  patch: Partial<HomecomingIdentity>,
  now = new Date().toISOString(),
): HomecomingWeekPlan {
  const safe = { ...patch };
  if (safe.preferredName !== undefined) safe.preferredName = cap(safe.preferredName, 80);
  if (safe.exactAge !== undefined) safe.exactAge = cap(safe.exactAge.replace(/\D/g, ''), 3);
  const identity = { ...plan.identity, ...safe };
  let discharge = plan.discharge;
  if (identity.ageBand === 'under_18') {
    discharge = {
      ...discharge,
      housingType: 'family_home',
      adultReturnHomeConfirmed: false,
      adultReturnHomeQuote: '',
    };
  } else if (identity.ageBand === 'adult' && plan.identity.ageBand === 'under_18') {
    discharge = { ...discharge, housingType: '', housingDetails: '', receivingAdult: '' };
  }
  return { ...plan, identity, discharge, updatedAt: now };
}

export function updateHomecomingDischarge(
  plan: HomecomingWeekPlan,
  patch: Partial<HomecomingDischarge>,
  now = new Date().toISOString(),
): HomecomingWeekPlan {
  const safe: Partial<HomecomingDischarge> = { ...patch };
  for (const key of Object.keys(safe) as (keyof HomecomingDischarge)[]) {
    const value = safe[key];
    if (typeof value === 'string') {
      const limit = key === 'otherInstructions' || key === 'adultReturnHomeQuote' || key === 'soberLivingRules'
        ? HOMECOMING_DETAIL_LIMIT : HOMECOMING_FIELD_LIMIT;
      (safe as Record<string, unknown>)[key] = cap(value, limit);
    }
  }
  if (plan.identity.ageBand !== 'adult') {
    safe.adultReturnHomeConfirmed = false;
    safe.adultReturnHomeQuote = '';
  }
  return { ...plan, discharge: { ...plan.discharge, ...safe }, updatedAt: now };
}

export function updateHomecomingItem(
  plan: HomecomingWeekPlan,
  id: HomecomingItemId,
  patch: Partial<Omit<HomecomingItemState, 'updatedAt'>>,
  now = new Date().toISOString(),
): HomecomingWeekPlan {
  const safe = { ...patch };
  for (const key of ['person', 'place', 'time', 'backup'] as const) {
    if (safe[key] !== undefined) safe[key] = cap(safe[key]!);
  }
  if (safe.details !== undefined) safe.details = cap(safe.details, HOMECOMING_DETAIL_LIMIT);
  return {
    ...plan,
    items: { ...plan.items, [id]: { ...plan.items[id], ...safe, updatedAt: now } },
    updatedAt: now,
  };
}

function safeString(value: unknown, limit = HOMECOMING_FIELD_LIMIT): string {
  return typeof value === 'string' ? cap(value, limit) : '';
}
function safeDate(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime()) ? value : null;
}
function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

export function parseHomecomingWeekPlan(raw: string | null): HomecomingWeekPlan {
  const fallback = defaultHomecomingWeekPlan();
  if (!raw) return fallback;
  try {
    const candidate = JSON.parse(raw) as Record<string, unknown>;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return fallback;
    const i = candidate.identity && typeof candidate.identity === 'object' ? candidate.identity as Record<string, unknown> : {};
    const d = candidate.discharge && typeof candidate.discharge === 'object' ? candidate.discharge as Record<string, unknown> : {};
    let plan = updateHomecomingIdentity(fallback, {
      preferredName: safeString(i.preferredName, 80),
      ageBand: enumValue(i.ageBand, ['', 'under_18', 'adult'] as const, ''),
      exactAge: safeString(i.exactAge, 3).replace(/\D/g, ''),
      gender: enumValue(i.gender, ['', 'woman', 'man', 'nonbinary', 'prefer_not_to_say'] as const, ''),
    }, safeDate(candidate.updatedAt) ?? new Date(0).toISOString());
    const discharge = { ...EMPTY_DISCHARGE } as Record<string, unknown>;
    for (const key of Object.keys(EMPTY_DISCHARGE) as (keyof HomecomingDischarge)[]) {
      const defaultValue = EMPTY_DISCHARGE[key];
      if (typeof defaultValue === 'boolean') discharge[key] = d[key] === true;
      else discharge[key] = safeString(d[key], key === 'otherInstructions' || key === 'adultReturnHomeQuote' || key === 'soberLivingRules' ? HOMECOMING_DETAIL_LIMIT : HOMECOMING_FIELD_LIMIT);
    }
    discharge.level = enumValue(d.level, ['', 'detox', 'residential', 'php', 'iop', 'outpatient', 'other'] as const, '');
    discharge.housingType = enumValue(d.housingType, ['', 'family_home', 'sober_living', 'own_home', 'partner', 'friend', 'other'] as const, '');
    discharge.soberLivingStatus = enumValue(d.soberLivingStatus, ['', 'named', 'none_named'] as const, '');
    discharge.outpatientStatus = enumValue(d.outpatientStatus, ['', 'named', 'none_named'] as const, '');
    discharge.fellowship = enumValue(d.fellowship, ['', 'aa', 'na', 'ca', 'smart', 'refuge', 'other'] as const, '');
    discharge.meetingsKnown = enumValue(d.meetingsKnown, ['', 'yes', 'no'] as const, '');
    discharge.employmentStatus = enumValue(d.employmentStatus, ['', 'work', 'school', 'not_yet', 'disabled', 'unknown'] as const, '');
    discharge.aftercareStatus = enumValue(d.aftercareStatus, ['', 'named', 'none_named'] as const, '');
    discharge.medicationStatus = enumValue(d.medicationStatus, ['', 'yes', 'no'] as const, '');
    plan = updateHomecomingDischarge(plan, discharge as HomecomingDischarge, safeDate(candidate.updatedAt) ?? new Date(0).toISOString());
    const sourceItems = candidate.items && typeof candidate.items === 'object' && !Array.isArray(candidate.items)
      ? candidate.items as Record<string, unknown> : {};
    const items = { ...plan.items };
    for (const definition of HOMECOMING_ITEMS) {
      const source = sourceItems[definition.id];
      if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
      const row = source as Record<string, unknown>;
      items[definition.id] = {
        status: enumValue(row.status, ['not_started', 'working', 'confirmed', 'not_applicable'] as const, 'not_started'),
        person: safeString(row.person), place: safeString(row.place), time: safeString(row.time), backup: safeString(row.backup),
        details: safeString(row.details, HOMECOMING_DETAIL_LIMIT), updatedAt: safeDate(row.updatedAt),
      };
    }
    return { ...plan, items, updatedAt: safeDate(candidate.updatedAt) };
  } catch {
    return fallback;
  }
}
