import { useCallback } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';

/**
 * The Tracker is no longer a tab (4.4): it is the pushed screen `app/tracker.tsx`
 * at `/tracker`. This hidden tab stays registered so an old link to
 * `/(tabs)/tracker` still opens the Tracker.
 *
 * It first leaves this empty tab for Today, then pushes the Tracker on top, so
 * Back from the Tracker lands on Today and never comes back here (which would
 * open the Tracker again). A plain `/tracker` always means the pushed screen
 * (expo-router ranks the route outside the tab group first), so this cannot
 * loop. Nothing here reads data; the Tracker keeps its own membership gate.
 */
export default function TrackerTabRedirect() {
  const router = useRouter();
  useFocusEffect(useCallback(() => {
    router.navigate('/(tabs)');
    router.push('/tracker');
  }, [router]));
  return null;
}
