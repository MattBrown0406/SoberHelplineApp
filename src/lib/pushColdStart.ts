import type { Entitlements } from '../api/types';
import { entitlementsForAccountState } from './featureAccess';
import { getPushDestination } from './pushRouting';

// A notification tapped during a slow cold start is routed while the account
// still carries its first-render entitlements, which fall back to direct-free
// when the 1s entitlement read is slow. The tap is then de-duplicated, so a
// Premier member's video push could land on a paywall for good. Hold such a tap
// until AccountContext reports the entitlements settled — but only when the
// destination could actually change with more access.

const EVERY_ENTITLEMENT: Entitlements = Object.fromEntries(
  Object.keys(entitlementsForAccountState('direct-free')).map((key) => [key, true]),
) as unknown as Entitlements;

/** Whether routing this push now could send the member somewhere less useful than after enrichment. */
export function shouldDeferPushRouting(
  data: Record<string, unknown>,
  entitlements: Entitlements | null,
  entitlementsSettled: boolean,
  nowMs = Date.now(),
): boolean {
  if (entitlementsSettled) return false;
  const now = getPushDestination(data, { nowMs, entitlements });
  const withAccess = getPushDestination(data, { nowMs, entitlements: EVERY_ENTITLEMENT });
  return JSON.stringify(now) !== JSON.stringify(withAccess);
}
