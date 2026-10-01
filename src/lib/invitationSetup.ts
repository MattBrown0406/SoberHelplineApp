/**
 * Pattern map flow (CRAFT functional analysis) — steps, tap-to-add suggestion
 * chips, tracker-seeded suggestions and the loved_ones prefill. Pure; chip
 * labels live in invitation.json under setup.suggestions.<field>.<key>.
 */
import {
  addProfileItem,
  emptyLovedOneProfile,
  inferSoberTimes,
  prefillSoberTimes,
  type LovedOneProfile,
  type ProfileListField,
} from './lovedOneProfile';

export const SETUP_STEPS = [
  'intro',
  'basics',
  'safety',
  'triggers',
  'gives',
  'costs',
  'sober',
  'phrases',
  'incidents',
  'review',
  'alerts',
] as const;
export type SetupStep = typeof SETUP_STEPS[number];

/** The list each list-step edits. */
export const STEP_FIELD: Readonly<Partial<Record<SetupStep, ProfileListField>>> = {
  triggers: 'useTriggers',
  gives: 'whatUseGives',
  costs: 'costsTheyFeel',
  sober: 'soberMoments',
  phrases: 'usualPhrases',
  incidents: 'recentIncidents',
};

export const RELATIONSHIP_KEYS = ['son', 'daughter', 'spouse', 'partner', 'parent', 'sibling', 'friend', 'other'] as const;
export const SUBSTANCE_KEYS = ['alcohol', 'opioids', 'stimulants', 'cannabis', 'prescription', 'other'] as const;

export const SUGGESTIONS: Readonly<Record<Exclude<ProfileListField, 'recentIncidents'>, readonly string[]>> = {
  useTriggers: ['afterWork', 'weekends', 'payday', 'oldFriends', 'stress', 'arguments', 'lateNight', 'alone', 'games', 'pain'],
  whatUseGives: ['relief', 'sleep', 'confidence', 'numb', 'belonging', 'fun', 'escape', 'energy'],
  costsTheyFeel: ['health', 'job', 'money', 'relationship', 'kids', 'legal', 'sleep', 'respect'],
  soberMoments: ['mornings', 'weekendMornings', 'drives', 'meals', 'kids', 'goodDay', 'outdoors', 'beforeWork'],
  usualPhrases: ['canStop', 'overreacting', 'everyone', 'cutBack', 'leaveMe', 'notNow', 'notThatBad', 'onMyCase'],
};

/**
 * Warning signs from the tracker that point at a pattern-map suggestion. Only
 * mappings a family would recognize as the same thing.
 */
export const TRACKER_SEEDS: Readonly<Record<string, ReadonlyArray<{ field: Exclude<ProfileListField, 'recentIncidents'>; key: string }>>> = {
  'w-friends': [{ field: 'useTriggers', key: 'oldFriends' }],
  'w-money': [{ field: 'useTriggers', key: 'payday' }, { field: 'costsTheyFeel', key: 'money' }],
  'w-sleep': [{ field: 'useTriggers', key: 'lateNight' }, { field: 'costsTheyFeel', key: 'sleep' }],
  'w-defensive': [{ field: 'usualPhrases', key: 'onMyCase' }],
  'w-sick': [{ field: 'costsTheyFeel', key: 'health' }],
  'w-weight': [{ field: 'costsTheyFeel', key: 'health' }],
};

/** Suggestion keys for a list: tracker-seeded ones first (flagged), then the rest. */
export function suggestionKeys(
  field: ProfileListField,
  warningSigns: readonly string[],
): Array<{ key: string; fromTracker: boolean }> {
  if (field === 'recentIncidents') return [];
  const seeded = new Set(
    warningSigns.flatMap((sign) => (TRACKER_SEEDS[sign] ?? []).filter((seed) => seed.field === field).map((seed) => seed.key)),
  );
  const all = SUGGESTIONS[field];
  return [
    ...all.filter((key) => seeded.has(key)).map((key) => ({ key, fromTracker: true })),
    ...all.filter((key) => !seeded.has(key)).map((key) => ({ key, fromTracker: false })),
  ];
}

/** The steps this member walks through. Alerts are paid and never offered on the safety-first path. */
export function setupSteps(options: { paid: boolean; safetySerious: boolean }): SetupStep[] {
  return SETUP_STEPS.filter((step) => step !== 'alerts' || (options.paid && !options.safetySerious));
}

export type LovedOneBasics = {
  first_name?: string | null;
  relationship?: string | null;
  substances?: string[] | null;
};

/**
 * Start from the saved pattern map, filling name/relationship/substances from
 * the loved_ones record where the map has none yet, and prefilling sober-time
 * chips from their sober moments when none are selected.
 */
export function prefillProfile(saved: LovedOneProfile | null, lovedOne: LovedOneBasics | null): LovedOneProfile {
  const base = saved ? { ...saved } : emptyLovedOneProfile();
  if (!base.name.trim() && lovedOne?.first_name?.trim()) base.name = lovedOne.first_name.trim().slice(0, 40);
  if (!base.relationship && lovedOne?.relationship) base.relationship = lovedOne.relationship;
  if (!base.substances.length && lovedOne?.substances?.length) base.substances = lovedOne.substances.slice(0, 6);
  return prefillSoberTimes(base);
}

/** Monday (YYYY-MM-DD) one week before the week containing localDate. */
export function previousWeekStart(localDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  const date = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : new Date();
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (day === 0 ? -6 : 1 - day) - 7);
  return date.toISOString().slice(0, 10);
}

/**
 * Runs async tasks one at a time, in call order, whatever each one's timing —
 * so the immediate save of a safety answer can never land after (and
 * overwrite) a later save from the Next button. A failed task doesn't stop
 * the ones queued after it.
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T,>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  };
}

/** How long leaving setup waits for pending saves before going anyway. */
export const LEAVE_SAVE_TIMEOUT_MS = 2500;

/**
 * Resolve with the promise's value, or 'timeout' after `ms` — leaving setup
 * waits for her edits to save but never hangs on a slow network (the queued
 * save keeps going in the background).
 */
export function settleWithin<T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve('timeout'); },
    );
  });
}

/**
 * One list change on the map. While she hasn't touched the sober times and
 * none are chosen, her sober-moment words prefill them; saving keeps exactly
 * what is selected.
 */
export function withListItems(
  profile: LovedOneProfile,
  field: ProfileListField,
  items: string[],
  timesTouched: boolean,
): LovedOneProfile {
  if (field === 'soberMoments' && !timesTouched && !(profile.soberTimes ?? []).length) {
    return { ...profile, soberMoments: items, soberTimes: inferSoberTimes(items) };
  }
  return { ...profile, [field]: items };
}

/**
 * Text typed on a list step but never Added belongs to THAT step's list: it
 * is folded in before Next, Previous, Back or leaving — never carried into
 * the next step's field, never silently lost. null when there's nothing new
 * to add (no list on this step, blank text, a duplicate, or a full list).
 */
export function commitPendingItem(
  profile: LovedOneProfile,
  field: ProfileListField | undefined,
  text: string,
  timesTouched: boolean,
): LovedOneProfile | null {
  if (!field || !text.trim()) return null;
  const items = addProfileItem(profile[field], text);
  if (items.length === profile[field].length) return null;
  return withListItems(profile, field, items, timesTouched);
}
