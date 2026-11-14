import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isReturnAfterAbsence, lastOpenedStorageKey } from '../lib/welcomeBack';

/**
 * Notes on the device when this account last had the app open, and says when
 * she is back after a week or more away. `visible` is the welcome-back card
 * for this visit: it goes when she dismisses it or takes its first action,
 * and comes back only after the next seven-day gap. `returned` stays true for
 * the rest of the visit, so Today does not follow the welcome with another
 * ask; `ready` is false until the first look has finished.
 */
export function useWelcomeBack(accountId: string | null) {
  const [visible, setVisible] = useState(false);
  const [returned, setReturned] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setVisible(false);
    setReturned(false);
    setReady(false);
    if (!accountId) return undefined;
    let active = true;
    const key = lastOpenedStorageKey(accountId);
    const look = async () => {
      const now = new Date();
      try {
        const last = await AsyncStorage.getItem(key);
        // Written at once, so this return is welcomed only once.
        await AsyncStorage.setItem(key, now.toISOString());
        if (active && isReturnAfterAbsence(last, now)) {
          setVisible(true);
          setReturned(true);
        }
      } catch {
        // Unreadable storage: no welcome, rather than one on a guess.
      }
      if (active) setReady(true);
    };
    void look();
    // The app can sit in the background for a week without being closed.
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void look();
    });
    return () => {
      active = false;
      appState.remove();
    };
  }, [accountId]);

  const dismiss = useCallback(() => setVisible(false), []);

  return { visible, returned, ready, dismiss };
}
