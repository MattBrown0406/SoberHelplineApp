import type { AccountState, Entitlements, ProductFeature } from '../api/types';

/**
 * The only product-feature map. Gate reads these API-contract booleans; screens
 * never infer access from account tiers.
 */
export const FEATURE_ENTITLEMENT_MAP: Readonly<Record<ProductFeature, keyof Entitlements>> = Object.freeze({
  tracker: 'canAccessTracker',
  todayFull: 'canAccessFullToday',
  aiRehearsal: 'canAccessAiRehearsal',
  community: 'canAccessGroups',
  diyIntervention: 'canAccessDiyIntervention',
  practicePush: 'canUsePracticePush',
  crisisCommandPlan: 'canAccessCrisisCommandPlan',
  planReview: 'canAccessPlanReview',
  includedPlanReview: 'hasIncludedPlanReview',
});

/** The sole account-state → entitlement resolver, used at account bootstrap. */
export function entitlementsForAccountState(accountState: AccountState, adminOverride = false): Entitlements {
  const isPaid = accountState !== 'direct-free';
  const isPremier = accountState === 'attached' || accountState === 'direct-premium';
  const entitlements: Entitlements = {
    canMessageOnCallCoach: isPaid,
    canCallCoach: isPremier,
    canAccessPrivateVideo: isPremier,
    canCallAfterHours: accountState === 'attached',
    canAccessGroups: isPaid,
    canAccessLearningContent: true,
    hasAssignedCoach: accountState === 'attached',
    canAccessTracker: true,
    canAccessFullToday: isPaid,
    canAccessAiRehearsal: isPaid,
    canAccessDiyIntervention: isPaid,
    canUsePracticePush: isPaid,
    canAccessCrisisCommandPlan: isPremier,
    canAccessPlanReview: isPaid,
    hasIncludedPlanReview: isPremier,
  };
  if (!adminOverride) return entitlements;
  // Admin QA access is constructed once in the account authority. Consumers
  // still read ordinary entitlement booleans and never add local exceptions.
  return {
    ...entitlements,
    canMessageOnCallCoach: true,
    canCallCoach: true,
    canAccessPrivateVideo: true,
    canCallAfterHours: true,
    canAccessGroups: true,
    canAccessLearningContent: true,
    canAccessTracker: true,
    canAccessFullToday: true,
    canAccessAiRehearsal: true,
    canAccessDiyIntervention: true,
    canUsePracticePush: true,
    canAccessCrisisCommandPlan: true,
    canAccessPlanReview: true,
    hasIncludedPlanReview: true,
  };
}

export function canAccessFeature(input: {
  feature: ProductFeature;
  entitlements: Entitlements;
}): boolean {
  return input.entitlements[FEATURE_ENTITLEMENT_MAP[input.feature]];
}