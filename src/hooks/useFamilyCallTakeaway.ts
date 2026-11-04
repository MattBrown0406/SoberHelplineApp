import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { parseFamilyCallTakeaway, type FamilyCallTakeaway } from '../lib/familyCallTakeaway';

export type { FamilyCallTakeaway } from '../lib/familyCallTakeaway';

/**
 * Re-read whenever Today comes into view or the app returns to the foreground:
 * Matt usually writes it Monday night, after the call, while Today stays mounted.
 */
export function useFamilyCallTakeaway(accountId: string | null): FamilyCallTakeaway | null {
  const [takeaway, setTakeaway] = useState<FamilyCallTakeaway | null>(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    const id = ++request.current;
    if (!accountId) {
      setTakeaway(null);
      return;
    }
    try {
      const { data, error } = await supabase.rpc('family_call_takeaway');
      if (id !== request.current) return;
      // Offline or an older backend: keep what is on screen.
      if (!error) setTakeaway(parseFamilyCallTakeaway(data));
    } catch {
      // Same: never blank the card on a failed read.
    }
  }, [accountId]);

  useEffect(() => {
    setTakeaway(null);
    void load();
    return () => { request.current += 1; };
  }, [load]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  // And on foreground: tapping Tuesday's note can resume a Today already in view.
  useEffect(() => {
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => appState.remove();
  }, [load]);

  return takeaway;
}
