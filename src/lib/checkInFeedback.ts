import type { CaregiverCheckInInput, CheckIn } from '../api/types';
import { caregiverResponseKey } from './caregiverCheckIn';

/**
 * "A practical next step" opens Today itself with "More for you" open (her
 * path is there). The button is on Today, inside the tabs, so this push is a
 * tab navigation that only sets Today's params; it never stacks a new copy
 * of the tabs (the old `/guided-journey` hop did).
 */
export const MORE_FOR_YOU_ROUTE = '/(tabs)?more=1';

export function checkInFeedback(checkIn: CaregiverCheckInInput | CheckIn) {
  const basic = caregiverResponseKey(checkIn);
  const key = basic === 'steady' && checkIn.moodScore <= 2 ? 'lowMood' : basic;
  const route = ({ safety: '/safety-wallet', overloaded: '/(tabs)/support', connection: '/(tabs)/support', boundary: '/(tabs)/scripts?section=boundaries', plan: MORE_FOR_YOU_ROUTE, rest: '/(tabs)/scripts', steady: '/(tabs)/learn', lowMood: '/(tabs)/support' } as const)[key];
  return { key, route } as const;
}

/** The route to push on a tap: "More for you" gets a fresh `n`, so a repeat tap opens it again. */
export function checkInFeedbackHref(route: ReturnType<typeof checkInFeedback>['route'], nowMs = Date.now()): string {
  return route === MORE_FOR_YOU_ROUTE ? `${route}&n=${nowMs}` : route;
}
