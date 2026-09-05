import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createGuidedStartStore } from '../storage/guidedStartStore';
import { emptyGuidedStart, type GuidedStart } from '../lib/guidedStart';
const store = createGuidedStartStore(AsyncStorage);
const signedOut = { value: emptyGuidedStart(), ready: false, busy: false, error: null } as const;
export function useGuidedStart(accountId: string | null) {
  const active = useRef(accountId); active.current = accountId;
  const subscribe = useCallback((fn: () => void) => accountId ? store.subscribe(accountId, fn) : () => {}, [accountId]);
  const snapshot = useCallback(() => accountId ? store.snapshot(accountId) : signedOut, [accountId]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => { active.current = accountId; if (accountId) void store.load(accountId); return () => { active.current = null; }; }, [accountId]);
  const requireAccount = () => { if (!accountId || active.current !== accountId) throw Error('Account changed'); return accountId; };
  return { ...state,
    edit: async (fn: (v: GuidedStart) => GuidedStart) => store.edit(requireAccount(), fn),
    reset: async () => store.reset(requireAccount()),
    retry: async () => store.load(requireAccount()),
  };
}
