import type { Entitlements } from '../api/types';

/**
 * 1:1 coaching price. Members (Essential, Premier, or an active provider org)
 * pay the member price; everyone else pays the standard price. The server is
 * the authority for what is charged (create-plan-review-checkout quotes $125
 * to members; soberhelpline.com's booking charges members $125) — the app only
 * shows the matching number.
 */
export const COACHING_STANDARD_PRICE = '$150';
export const COACHING_MEMBER_PRICE = '$125';

/** Same rule as the server's has_active_textline_access: paid tier or active org. */
export function isCoachingMember(
  entitlements: Pick<Entitlements, 'canMessageOnCallCoach'> | null | undefined,
): boolean {
  return !!entitlements?.canMessageOnCallCoach;
}

export function coachingPriceAmount(member: boolean): string {
  return member ? COACHING_MEMBER_PRICE : COACHING_STANDARD_PRICE;
}

export interface CoachingRateCopy {
  member: boolean;
  /** "$125" or "$150". */
  amount: string;
  /** "$125 member price" or "$150". */
  rate: string;
  /** "$125/hour member price" or "$150/hour". */
  hourly: string;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Localized price labels; `t` is bound to the `common` namespace. */
export function coachingRateCopy(member: boolean, t: Translate): CoachingRateCopy {
  const amount = coachingPriceAmount(member);
  return {
    member,
    amount,
    rate: member ? t('coachingPrice.member', { price: amount }) : amount,
    hourly: t(member ? 'coachingPrice.memberHourly' : 'coachingPrice.hourly', { price: amount }),
  };
}

/** Fills `{rate}` / `{memberRate}` placeholders in content-file copy. */
export function fillCoachingRates(text: string, rates: { rate: string; memberRate: string }): string {
  return text.replace(/\{rate\}/g, rates.rate).replace(/\{memberRate\}/g, rates.memberRate);
}
