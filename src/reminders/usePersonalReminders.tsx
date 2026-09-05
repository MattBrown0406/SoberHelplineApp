import { useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { personalReminders } from './native';

/** Mount once under AccountProvider. Pass useAccount().user?.id ?? null.
 * ready must be !isLoading: unresolved bootstrap is not a logout.
 * No notification response listener: payload has no destination or account data.
 */
export function PersonalRemindersLifecycle({ accountId, ready }: { accountId: string | null; ready: boolean }) {
  useEffect(() => {
    if (!ready) return;
    void personalReminders.setAccount(accountId).catch(() => undefined);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void personalReminders.setAccount(accountId).catch(() => undefined);
    });
    return () => { subscription.remove(); };
  }, [accountId, ready]);
  return null;
}

export function usePersonalReminders(accountId: string | null) {
  const state = useSyncExternalStore(personalReminders.subscribe, personalReminders.snapshot, personalReminders.snapshot);
  // Hide the previous account synchronously, before the lifecycle effect runs.
  const matches = state.accountId === accountId;
  return {
    ...state,
    ready: matches && state.ready,
    items: matches ? state.items : [],
    error: matches ? state.error : null,
    service: personalReminders,
  };
}
