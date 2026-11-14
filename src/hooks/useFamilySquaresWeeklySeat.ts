import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { loadWeeklySeat, saveWeeklySeat, subscribeWeeklySeat } from '../lib/familySquaresSeat';

/**
 * "Save my seat every Monday" for this account: the saved value (false until
 * it loads), whether a change is being saved, and a setter that answers true
 * when the server kept the change. The switch moves at once and goes back if
 * the save fails.
 */
export function useFamilySquaresWeeklySeat(accountId: string | null) {
  const [enabled, setEnabledState] = useState(false);
  const [busy, setBusy] = useState(false);
  const identity = useRef(accountId);
  identity.current = accountId;
  const saving = useRef(false);

  const load = useCallback(async () => {
    if (!accountId) {
      setEnabledState(false);
      return;
    }
    const saved = await loadWeeklySeat(accountId);
    // A failed read keeps what is on screen; a change in flight wins over a slow read.
    if (saved !== null && identity.current === accountId && !saving.current) setEnabledState(saved);
  }, [accountId]);

  useEffect(() => {
    setEnabledState(false);
    void load();
  }, [load]);
  // Settings can change it while Today and Support stay mounted underneath.
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => subscribeWeeklySeat((changedAccount, value) => {
    if (changedAccount === identity.current) setEnabledState(value);
  }), []);

  const setEnabled = useCallback(async (next: boolean): Promise<boolean> => {
    if (!accountId || saving.current) return false;
    saving.current = true;
    setBusy(true);
    setEnabledState(next);
    const saved = await saveWeeklySeat(accountId, next);
    saving.current = false;
    if (identity.current !== accountId) return saved;
    setBusy(false);
    if (!saved) setEnabledState(!next);
    return saved;
  }, [accountId]);

  return { enabled, busy, setEnabled };
}
