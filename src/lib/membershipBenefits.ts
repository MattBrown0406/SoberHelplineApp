import type { Entitlements } from '../api/types';

/**
 * What each plan includes, in the order it is shown: most valued first.
 *
 * The words live in one place, src/locales/<lang>/plans.json under
 * `benefits.<plan>.<key>`, and every screen that describes a plan reads them
 * through this file (plans screen, purchase sheet, Settings, the paywall
 * card, the Support tab, the membership guide).
 *
 * Each line names the entitlement that makes it true. featureAccess.ts is
 * the only place access is decided, and tests/membership-plans.test.ts fails
 * if a line here stops matching it. A benefit the app cannot deliver (for
 * example canCallCoach, which no screen uses) is not listed.
 */
type Benefit = {
  key: string;
  entitlement: keyof Entitlements;
  /**
   * The family education library and past Family Squares recordings are
   * member pages on the English website only (see app/(tabs)/learn.tsx: in
   * Spanish the library is public and La Sobremesa is not recorded).
   */
  englishOnly?: true;
};

/** Stays free. Every entitlement here is true for a free account. */
export const FREE_BENEFITS = [
  { key: 'familySquares', entitlement: 'canAccessLearningContent' },
  { key: 'crisisGuide', entitlement: 'canShareSafetyWallet' },
  { key: 'everydayTools', entitlement: 'canAccessTracker' },
  { key: 'scripts', entitlement: 'canAccessLearningContent' },
  { key: 'planning', entitlement: 'canAccessLearningContent' },
  { key: 'patternMap', entitlement: 'canAccessLearningContent' },
] as const satisfies readonly Benefit[];

/** Essential: every entitlement here is false for a free account and true for Essential. */
export const ESSENTIAL_BENEFITS = [
  { key: 'coachMessaging', entitlement: 'canMessageOnCallCoach' },
  { key: 'liveGroups', entitlement: 'canAccessGroups' },
  { key: 'rehearsal', entitlement: 'canAccessAiRehearsal' },
  { key: 'interventionPlanner', entitlement: 'canAccessDiyIntervention' },
  { key: 'invitationEngine', entitlement: 'canAccessInvitationEngine' },
  { key: 'practiceCalls', entitlement: 'canUsePracticePush' },
  { key: 'todayFull', entitlement: 'canAccessFullToday' },
  // The member coaching rate follows coach messaging (coachingPrice.isCoachingMember).
  { key: 'memberRate', entitlement: 'canMessageOnCallCoach' },
  { key: 'library', entitlement: 'canAccessGroups', englishOnly: true },
] as const satisfies readonly Benefit[];

/** What Premier adds: false for Essential, true for Premier. */
export const PREMIER_BENEFITS = [
  { key: 'privateVideo', entitlement: 'canAccessPrivateVideo' },
  { key: 'planReview', entitlement: 'hasIncludedPlanReview' },
  { key: 'commandPlan', entitlement: 'canAccessCrisisCommandPlan' },
] as const satisfies readonly Benefit[];

export type BenefitPlan = 'free' | 'essential' | 'premier';

const BENEFITS: Record<BenefitPlan, readonly Benefit[]> = {
  free: FREE_BENEFITS,
  essential: ESSENTIAL_BENEFITS,
  premier: PREMIER_BENEFITS,
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The benefit keys shown for a plan in this language, in order. */
export function benefitKeys(plan: BenefitPlan, language: string | null | undefined): string[] {
  const spanish = (language ?? 'en').startsWith('es');
  return BENEFITS[plan].filter((benefit) => !(spanish && benefit.englishOnly)).map((benefit) => benefit.key);
}

/** The plan's benefit lines. `t` is bound to the `plans` namespace. */
export function benefitLines(plan: BenefitPlan, t: Translate, language: string | null | undefined): string[] {
  return benefitKeys(plan, language).map((key) => t(`benefits.${plan}.${key}`));
}

/**
 * One line for tight places (the Settings membership line, the paywall card):
 * the plan's first few benefits, in order. Premier's line starts by saying it
 * includes Essential.
 */
export function benefitSummary(plan: BenefitPlan, t: Translate, language: string | null | undefined, count = 3): string {
  const lines = benefitLines(plan, t, language).slice(0, count);
  const separator = t('summarySeparator');
  return (plan === 'premier' ? [t('headings.premierShort'), ...lines] : lines).join(separator);
}

/** The plan a paid account state is on, for the "Current plan" marker. */
export function planForAccountState(accountState: string | null | undefined): BenefitPlan | 'covered' {
  if (accountState === 'attached') return 'covered';
  if (accountState === 'direct-premium') return 'premier';
  if (accountState === 'direct-essential') return 'essential';
  return 'free';
}
