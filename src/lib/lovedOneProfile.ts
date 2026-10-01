/**
 * The family's picture of their loved one, built in the Invitation Engine's
 * pattern map (CRAFT functional analysis) and reused by conversation practice
 * so the AI partner sounds like *their* person. Free text is the family's own
 * words; every list is short by design.
 */
export type LovedOneProfile = {
  /** First name or nickname the family uses. */
  name: string;
  relationship: string;
  substances: string[];
  /** When/where/with whom use tends to happen (e.g. "Friday nights", "after work with Dan"). */
  useTriggers: string[];
  /** What using seems to give them (relief, sleep, belonging…). */
  whatUseGives: string[];
  /** Costs of use the loved one themselves has felt (job, girlfriend, health…). */
  costsTheyFeel: string[];
  /** Moments they are sober and reachable (e.g. "Saturday mornings", "on drives"). */
  soberMoments: string[];
  /** Things they actually say when help comes up (their deflections, verbatim). */
  usualPhrases: string[];
  /** Recent incidents the family may reference in practice. */
  recentIncidents: string[];
  /** Safety screen: any violence or threats when confronted. */
  safetyConcern: 'none' | 'some' | 'serious' | '';
  updatedAt: string | null;
  /**
   * Coarse parts of the day/week they are most often sober and reachable —
   * the receptivity forecast's time-of-day signal. Optional: older callers and
   * conversation practice ignore it.
   */
  soberTimes?: SoberTime[];
  /** When the family finished the pattern map (null while it is a draft). */
  completedAt?: string | null;
};

export const SOBER_TIME_OPTIONS = ['morning', 'afternoon', 'evening', 'weekend'] as const;
export type SoberTime = typeof SOBER_TIME_OPTIONS[number];

export const SAFETY_CONCERNS = ['none', 'some', 'serious'] as const;

export const PROFILE_LIST_LIMIT = 6;
export const PROFILE_ITEM_MAX = 160;
export const PROFILE_NAME_MAX = 40;

/** The list fields of the pattern map, in the order the flow asks for them. */
export const PROFILE_LIST_FIELDS = [
  'useTriggers',
  'whatUseGives',
  'costsTheyFeel',
  'soberMoments',
  'usualPhrases',
  'recentIncidents',
] as const;
export type ProfileListField = typeof PROFILE_LIST_FIELDS[number];

export function emptyLovedOneProfile(): LovedOneProfile {
  return {
    name: '',
    relationship: '',
    substances: [],
    useTriggers: [],
    whatUseGives: [],
    costsTheyFeel: [],
    soberMoments: [],
    usualPhrases: [],
    recentIncidents: [],
    safetyConcern: '',
    updatedAt: null,
    soberTimes: [],
    completedAt: null,
  };
}

/** True once the family has described enough for practice to personalize. */
export function profileHasSubstance(profile: LovedOneProfile | null): boolean {
  if (!profile) return false;
  return profile.usualPhrases.length > 0 || profile.useTriggers.length > 0 || profile.recentIncidents.length > 0;
}

export function isProfileComplete(profile: LovedOneProfile | null): boolean {
  return !!profile?.completedAt;
}

export function isSafetySerious(profile: LovedOneProfile | null): boolean {
  return profile?.safetyConcern === 'serious';
}

/** One item of the family's own words: single line, trimmed, bounded. */
export function cleanProfileItem(value: string, max = PROFILE_ITEM_MAX): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

/** Add an item to a list: de-duplicated (case-insensitive) and capped. */
export function addProfileItem(list: readonly string[], value: string): string[] {
  const item = cleanProfileItem(value);
  if (!item || list.length >= PROFILE_LIST_LIMIT) return [...list];
  if (list.some((existing) => existing.toLowerCase() === item.toLowerCase())) return [...list];
  return [...list, item];
}

export function removeProfileItem(list: readonly string[], value: string): string[] {
  return list.filter((existing) => existing !== value);
}

function stringList(value: unknown, max = PROFILE_ITEM_MAX): string[] {
  if (!Array.isArray(value)) return [];
  return value.reduce<string[]>((out, item) => (
    typeof item === 'string' ? addProfileItem(out, item.slice(0, max)) : out
  ), []);
}

function soberTimeList(value: unknown): SoberTime[] {
  if (!Array.isArray(value)) return [];
  return SOBER_TIME_OPTIONS.filter((time) => value.includes(time));
}

function safetyValue(value: unknown): LovedOneProfile['safetyConcern'] {
  return value === 'none' || value === 'some' || value === 'serious' ? value : '';
}

/** A loved_one_profiles row (snake_case) → LovedOneProfile; null for junk. */
export function profileFromRow(row: unknown): LovedOneProfile | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  if (typeof r.account_id !== 'string') return null;
  return {
    name: typeof r.name === 'string' ? r.name.slice(0, PROFILE_NAME_MAX) : '',
    relationship: typeof r.relationship === 'string' ? r.relationship.slice(0, PROFILE_NAME_MAX) : '',
    substances: stringList(r.substances, PROFILE_NAME_MAX),
    useTriggers: stringList(r.use_triggers),
    whatUseGives: stringList(r.what_use_gives),
    costsTheyFeel: stringList(r.costs_they_feel),
    soberMoments: stringList(r.sober_moments),
    usualPhrases: stringList(r.usual_phrases),
    recentIncidents: stringList(r.recent_incidents),
    safetyConcern: safetyValue(r.safety_concern),
    updatedAt: typeof r.updated_at === 'string' ? r.updated_at : null,
    soberTimes: soberTimeList(r.sober_times),
    completedAt: typeof r.completed_at === 'string' ? r.completed_at : null,
  };
}

/** The save_loved_one_profile RPC payload (camelCase; the server re-validates). */
export function profileToPayload(profile: LovedOneProfile): Record<string, unknown> {
  return {
    name: cleanProfileItem(profile.name, PROFILE_NAME_MAX),
    relationship: cleanProfileItem(profile.relationship, PROFILE_NAME_MAX),
    substances: profile.substances.slice(0, PROFILE_LIST_LIMIT),
    useTriggers: profile.useTriggers.slice(0, PROFILE_LIST_LIMIT),
    whatUseGives: profile.whatUseGives.slice(0, PROFILE_LIST_LIMIT),
    costsTheyFeel: profile.costsTheyFeel.slice(0, PROFILE_LIST_LIMIT),
    soberMoments: profile.soberMoments.slice(0, PROFILE_LIST_LIMIT),
    // Exactly what the member selected: inference only ever prefills.
    soberTimes: mergeSoberTimes(profile.soberTimes ?? []),
    usualPhrases: profile.usualPhrases.slice(0, PROFILE_LIST_LIMIT),
    recentIncidents: profile.recentIncidents.slice(0, PROFILE_LIST_LIMIT),
    safetyConcern: profile.safetyConcern,
  };
}

// Only explicit parts of the day: meals ("Sunday dinner"), "night" or "late"
// say nothing reliable about when someone is sober and reachable.
const SOBER_TIME_WORDS: Record<SoberTime, RegExp> = {
  morning: /\b(mornings?|before work)\b|(?:^|[^\p{L}])(por la mañana|las mañanas|mañanas|antes del trabajo)(?![\p{L}])/iu,
  afternoon: /\bafternoons?\b|(?:^|[^\p{L}])(por la tarde|las tardes)(?![\p{L}])/iu,
  evening: /\b(evenings?|after work|after dinner)\b|(?:^|[^\p{L}])(por la noche|las noches|despu[ée]s del trabajo|despu[ée]s de cenar)(?![\p{L}])/iu,
  weekend: /\b(weekends?|saturdays?|sundays?)\b|(?:^|[^\p{L}])(fin de semana|fines de semana|s[áa]bados?|domingos?)(?![\p{L}])/iu,
};

/**
 * Coarse sober times read from the family's own words (EN + ES). Used only to
 * prefill an empty selection; the member's chips are what gets saved.
 */
export function inferSoberTimes(moments: readonly string[]): SoberTime[] {
  return SOBER_TIME_OPTIONS.filter((time) => moments.some((moment) => SOBER_TIME_WORDS[time].test(moment)));
}

export function mergeSoberTimes(...lists: ReadonlyArray<readonly string[]>): SoberTime[] {
  return SOBER_TIME_OPTIONS.filter((time) => lists.some((list) => list.includes(time)));
}

/** Prefill sober-time chips from the family's words when none are selected yet. */
export function prefillSoberTimes(profile: LovedOneProfile): LovedOneProfile {
  if ((profile.soberTimes ?? []).length || !profile.soberMoments.length) return profile;
  return { ...profile, soberTimes: inferSoberTimes(profile.soberMoments) };
}
