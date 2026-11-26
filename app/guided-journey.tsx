import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';

/**
 * The old 4-step starting-point journey (4.3 and before). Today now has one
 * "where to start": "Your path" (the loved one's phase and her next step for
 * it), under "More for you". The app no longer links here (the winback push
 * and the check-in's "a practical next step" open Today directly); the route
 * stays for older pushes and links: it goes back to Today with "More for you"
 * open. Steps an older version saved on the device are left as they are and
 * no longer read here.
 *
 * `dismissTo` (a stack POP_TO) pops back to the tabs already under this
 * screen. A `<Redirect>` (a stack REPLACE) would put a second copy of the
 * whole tab bar on the stack on every visit. With no tabs below (a cold
 * start), POP_TO swaps this screen for them instead.
 */
export default function GuidedJourneyScreen() {
  const router = useRouter();
  // A fresh value per visit, so Today opens "More for you" again on a repeat visit.
  const [visit] = useState(() => String(Date.now()));
  useFocusEffect(
    useCallback(() => {
      try {
        router.dismissTo({ pathname: '/(tabs)', params: { more: '1', n: visit } });
      } catch (error) {
        console.warn('[guided-journey] could not open Today', error);
      }
    }, [router, visit]),
  );
  return null;
}
