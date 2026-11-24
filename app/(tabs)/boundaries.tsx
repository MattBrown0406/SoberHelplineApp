import { useCallback } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';

/**
 * Boundaries is now a part of the Practice tab (src/components/practice/
 * BoundariesPractice). This hidden tab stays registered so every old link to
 * `/(tabs)/boundaries` (push, Today, check-in feedback, guided start, the
 * Tools tab, `sober-helpline://boundaries`) still lands on Boundaries: it
 * opens Practice on its Boundaries part.
 *
 * A tab cannot be replaced (the tab router has no REPLACE), so this navigates
 * to the Practice tab instead; the tabs' back behaviour returns to Today, never
 * to this empty screen. Nothing here reads data.
 */
export default function BoundariesTabRedirect() {
  const router = useRouter();
  useFocusEffect(useCallback(() => {
    router.navigate({ pathname: '/(tabs)/scripts', params: { section: 'boundaries' } });
  }, [router]));
  return null;
}
