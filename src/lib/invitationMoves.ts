/**
 * Daily moves — the CRAFT library behind the Invitation Engine's two actions a
 * day. Copy lives in src/locales/<lang>/invitation.json under moves.<id>.*
 * (title, body, example); this module owns ids, categories and selection.
 *
 * Selection is deterministic per plan and local day, so everyone in a family
 * space (same seed) sees the same two moves; logging stays per member.
 */
import type { LovedOneProfile } from './lovedOneProfile';

export const MOVE_CATEGORIES = ['reward', 'consequences', 'communication', 'timing', 'selfcare', 'safety'] as const;
export type MoveCategory = typeof MOVE_CATEGORIES[number];

export type MoveRequirement = 'soberMoments' | 'triggers' | 'costs' | 'phrases';

export type InvitationMove = {
  id: string;
  category: MoveCategory;
  /** Only offered when the family plan's pattern map has this signal. */
  requires?: MoveRequirement;
};

export type PlanSignals = {
  soberMoments: boolean;
  triggers: boolean;
  costs: boolean;
  phrases: boolean;
  safetySerious: boolean;
};

export const EMPTY_PLAN_SIGNALS: PlanSignals = Object.freeze({
  soberMoments: false,
  triggers: false,
  costs: false,
  phrases: false,
  safetySerious: false,
});

export const INVITATION_MOVES: readonly InvitationMove[] = Object.freeze([
  // Reward sober moments — specifically and immediately.
  { id: 'reward_name_it', category: 'reward' },
  { id: 'reward_sober_plan', category: 'reward' },
  { id: 'reward_best_hour', category: 'reward', requires: 'soberMoments' },
  { id: 'reward_thank_effort', category: 'reward' },
  { id: 'reward_warm_moment', category: 'reward' },
  // Step back from use; let natural consequences land.
  { id: 'step_back_when_using', category: 'consequences' },
  { id: 'let_it_land', category: 'consequences' },
  { id: 'no_cover_story', category: 'consequences' },
  { id: 'money_line', category: 'consequences' },
  { id: 'morning_after', category: 'consequences' },
  // Positive communication.
  { id: 'i_statement', category: 'communication' },
  { id: 'understanding', category: 'communication' },
  { id: 'partial_responsibility', category: 'communication' },
  { id: 'offer_help', category: 'communication' },
  { id: 'positive_request', category: 'communication' },
  { id: 'listen_first', category: 'communication' },
  { id: 'keep_it_short', category: 'communication' },
  { id: 'their_costs', category: 'communication', requires: 'costs' },
  { id: 'answer_their_line', category: 'communication', requires: 'phrases' },
  // Timing.
  { id: 'pick_the_moment', category: 'timing' },
  { id: 'not_while_using', category: 'timing' },
  { id: 'after_a_consequence', category: 'timing' },
  { id: 'plan_around_trigger', category: 'timing', requires: 'triggers' },
  // Self-care.
  { id: 'selfcare_one_thing', category: 'selfcare' },
  { id: 'selfcare_support', category: 'selfcare' },
  { id: 'selfcare_sleep', category: 'selfcare' },
  { id: 'selfcare_good_thing', category: 'selfcare' },
  { id: 'selfcare_breathe', category: 'selfcare' },
  // Safety-first path only.
  { id: 'safety_plan', category: 'safety' },
  { id: 'safety_code_word', category: 'safety' },
  { id: 'safety_talk_pro', category: 'safety' },
  { id: 'safety_not_alone', category: 'safety' },
] as InvitationMove[]);

/** A week of lead moves: rewarding and talking well come up most often. */
const PRIMARY_CYCLE: readonly MoveCategory[] = [
  'reward', 'communication', 'consequences', 'reward', 'communication', 'timing', 'communication',
];

const SECONDARY: Readonly<Record<'reward' | 'communication' | 'consequences' | 'timing', readonly [MoveCategory, MoveCategory]>> = {
  reward: ['communication', 'selfcare'],
  communication: ['reward', 'selfcare'],
  // Stepping back is hard: pair it with something for the family member.
  consequences: ['selfcare', 'reward'],
  timing: ['reward', 'selfcare'],
};

/** 32-bit FNV-1a: stable across devices and the server. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Days since 1970-01-01 for a YYYY-MM-DD calendar date (0 for junk). */
export function dayNumber(localDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return 0;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : 0;
}

export function moveById(id: string): InvitationMove | undefined {
  return INVITATION_MOVES.find((move) => move.id === id);
}

function pick(category: MoveCategory, signals: PlanSignals, seed: string, day: number): InvitationMove {
  const eligible = INVITATION_MOVES.filter((move) =>
    move.category === category && (!move.requires || signals[move.requires]));
  // A move built on the family's own pattern map comes up twice as often.
  const pool = [...eligible, ...eligible.filter((move) => move.requires)];
  return pool[(fnv1a(`${seed}:${category}`) + day) % pool.length];
}

/**
 * Today's two moves for a plan. The lead move rotates through the week; the
 * second always comes from a different category. A serious safety concern
 * switches the plan to safety planning plus self-care only.
 */
export function selectDailyMoves(input: {
  seed: string;
  localDate: string;
  signals: PlanSignals;
}): [InvitationMove, InvitationMove] {
  const seed = input.seed || 'solo';
  const day = dayNumber(input.localDate);
  const { signals } = input;
  if (signals.safetySerious) {
    return [pick('safety', signals, seed, day), pick('selfcare', signals, seed, day)];
  }
  const primary = PRIMARY_CYCLE[(day + (fnv1a(seed) % 7)) % 7] as keyof typeof SECONDARY;
  // Knowing when they are sober makes reward the natural partner of talking well.
  const secondary = primary === 'communication' && signals.soberMoments
    ? 'reward'
    : SECONDARY[primary][day % 2];
  return [pick(primary, signals, seed, day), pick(secondary, signals, seed, day)];
}

export type MoveHint = { key: 'moves.hint.soberMoments' | 'moves.hint.triggers' | 'moves.hint.costs' | 'moves.hint.phrases'; item: string };

const HINT_FIELD: Record<MoveRequirement, keyof Pick<LovedOneProfile, 'soberMoments' | 'useTriggers' | 'costsTheyFeel' | 'usualPhrases'>> = {
  soberMoments: 'soberMoments',
  triggers: 'useTriggers',
  costs: 'costsTheyFeel',
  phrases: 'usualPhrases',
};

/**
 * The viewer's own words for a move ("Your notes: “Saturday mornings”"). Read
 * only from the viewer's own profile — family members never see each other's
 * free text. Reward moves fall back to sober moments when they have no
 * requirement of their own.
 */
export function moveHint(move: InvitationMove, ownProfile: LovedOneProfile | null, localDate: string): MoveHint | null {
  if (!ownProfile) return null;
  const requirement: MoveRequirement | null = move.requires
    ?? (move.category === 'reward' ? 'soberMoments' : move.category === 'timing' ? 'triggers' : null);
  if (!requirement) return null;
  const list = ownProfile[HINT_FIELD[requirement]];
  if (!list.length) return null;
  const item = list[(fnv1a(move.id) + dayNumber(localDate)) % list.length];
  return { key: `moves.hint.${requirement}`, item };
}
