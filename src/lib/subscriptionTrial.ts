/**
 * A free trial the App Store will actually give this member, or null.
 *
 * Only a free (price 0) introductory offer counts, and only when StoreKit
 * says she is eligible: showing a trial to someone who already used one would
 * promise something the purchase sheet then takes back (App Review 3.1.2).
 * Pure (no RevenueCat import) so it runs in unit tests.
 */
export type TrialOffer = { unit: 'day'; count: number } | { unit: 'month'; count: number };

/** RevenueCat's INTRO_ELIGIBILITY_STATUS_ELIGIBLE. */
export const INTRO_ELIGIBLE = 2;

export interface IntroPriceLike {
  price: number;
  cycles: number;
  periodUnit: string;
  periodNumberOfUnits: number;
}

export function freeTrialOffer(intro: IntroPriceLike | null | undefined, eligibility: number | undefined): TrialOffer | null {
  if (eligibility !== INTRO_ELIGIBLE || !intro || intro.price !== 0) return null;
  const units = intro.periodNumberOfUnits * Math.max(1, intro.cycles);
  if (!Number.isInteger(units) || units < 1) return null;
  switch (intro.periodUnit) {
    case 'DAY': return units <= 90 ? { unit: 'day', count: units } : null;
    case 'WEEK': return units * 7 <= 90 ? { unit: 'day', count: units * 7 } : null;
    case 'MONTH': return units <= 12 ? { unit: 'month', count: units } : null;
    default: return null;
  }
}

/** i18n key + count for "7-day free trial" (support:paywall.trialDays / trialMonths). */
export function trialLabelKey(trial: TrialOffer): { key: 'paywall.trialDays' | 'paywall.trialMonths'; count: number } {
  return { key: trial.unit === 'day' ? 'paywall.trialDays' : 'paywall.trialMonths', count: trial.count };
}
