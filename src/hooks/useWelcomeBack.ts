import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isReturnAfterAbsence, lastOpenedStorageKey } from '../lib/welcomeBack';

/**
 * Notes on the device when this account last had the app open, and says when
 * she is back after a week or more away. `visible` is the welcome-back card
 * for this visit: it goes when she dismisses it or takes its first action,
 * and comes back only after the next seven-day gap. `returned` is true for the
 * rest of that visit (until the app next goes to the background, or for as
 * long as the card is still showing), so Today does not follow the welcome
 * with another ask; the next visit starts clean. `ready` is false until the
 * first look has finished.
 *
 * `decided()` answers "is this a welcome-back visit?" only once the look for
 * the current time in front has finished. Callers that react to the same
 * return to the app (Today's reminder ask) wait on it, so they never act a
 * moment before the welcome-back card appears.
 */
export function useWelcomeBack(accountId: string | null) {
  const [visible, setVisible] = useState(false);
  const [returned, setReturned] = useState(false);
  const [ready, setReady] = useState(false);
  // The same answers for decided(), which cannot wait for a render.
  const live = useRef({ visible: false, returned: false });
  const startLook = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    live.current = { visible: false, returned: false };
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
          live.current = { visible: true, returned: true };
          setVisible(true);
          setReturned(true);
        }
      } catch {
        // Unreadable storage: no welcome, rather than one on a guess.
      }
      if (active) setReady(true);
    };
    // One look per time in front. Whoever asks first (the listener below or
    // decided()) starts it; everyone else waits on the same one.
    let pending: Promise<void> | null = null;
    // True from the moment the app goes to the background until it is in
    // front again: nothing looks in between (a look writes "last opened").
    let away = false;
    const start = (): Promise<void> => {
      if (away && AppState.currentState !== 'active') return Promise.resolve();
      away = false;
      pending ??= look();
      return pending;
    };
    startLook.current = start;
    void start();
    // The app can sit in the background for a week without being closed.
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void start();
      // 'inactive' is only a system sheet or the app switcher passing over.
      if (state !== 'background') return;
      // The visit is over: the next time in front looks afresh, and "returned"
      // no longer holds other asks back (it used to for the whole run of the app).
      away = true;
      pending = null;
      if (live.current.returned) {
        live.current.returned = false;
        setReturned(false);
      }
    });
    return () => {
      active = false;
      startLook.current = null;
      appState.remove();
    };
  }, [accountId]);

  const dismiss = useCallback(() => {
    live.current.visible = false;
    setVisible(false);
  }, []);

  const decided = useCallback(async (): Promise<boolean> => {
    await startLook.current?.();
    return live.current.returned || live.current.visible;
  }, []);

  // A card still on screen from an earlier visit keeps other asks away too.
  return { visible, returned: returned || visible, ready, dismiss, decided };
}
