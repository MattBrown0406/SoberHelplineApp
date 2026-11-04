import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { bereavedCacheKey, isBereaved } from '../lib/bereavement';
import { requireSavedData } from '../lib/appFlowGuards';
import { captureAppError } from '../lib/monitoring';

export type LovedOneStatus =
  | 'stable'
  | 'in_treatment'
  | 'unknown'
  | 'using'
  | 'escalating'
  | 'crisis';

export interface LovedOne {
  id: string;
  account_id: string;
  relationship: string | null;
  first_name: string | null;
  substances: string[];
  stage: string | null;
  status: LovedOneStatus;
  created_at: string;
  updated_at: string;
  /** Set when she tells us her loved one died; null otherwise (and on old rows). */
  died_at?: string | null;
}

export interface LovedOneInput {
  relationship?: string | null;
  first_name?: string | null;
  substances?: string[];
  stage?: string | null;
  status?: LovedOneStatus;
}

/** Device copy of "her loved one died", so Today is right before (or without) the network read. */
function rememberBereaved(accountId: string, bereaved: boolean): void {
  const key = bereavedCacheKey(accountId);
  void (bereaved ? AsyncStorage.setItem(key, '1') : AsyncStorage.removeItem(key)).catch(() => undefined);
}

/** CRUD for the account's single loved-one record. */
export function useLovedOne(accountId: string | null) {
  const [record, setRecord] = useState<{ accountId: string | null; value: LovedOne | null }>({ accountId: null, value: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  // The device's last word on "they died" for this account: undefined until read.
  const [cached, setCached] = useState<{ accountId: string | null; bereaved: boolean | undefined }>({ accountId: null, bereaved: undefined });
  const scopeRef = useRef({ accountId, request: 0 });
  // The account whose record has loaded: later reads refresh it quietly.
  const settledFor = useRef<string | null>(null);
  if (scopeRef.current.accountId !== accountId) scopeRef.current = { accountId, request: 0 };

  useEffect(() => {
    if (!accountId) {
      setCached({ accountId, bereaved: false });
      return undefined;
    }
    let cancelled = false;
    AsyncStorage.getItem(bereavedCacheKey(accountId))
      .then((value) => { if (!cancelled) setCached({ accountId, bereaved: value === '1' }); })
      .catch(() => { if (!cancelled) setCached({ accountId, bereaved: false }); });
    return () => { cancelled = true; };
  }, [accountId]);

  const load = useCallback(async () => {
    const scope = scopeRef.current;
    if (scope.accountId !== accountId) return;
    const request = ++scope.request;
    if (!accountId) {
      setRecord({ accountId, value: null });
      setLoading(false);
      return;
    }
    // A refresh of a record already on screen is silent: no loading flash,
    // and a failed refresh keeps the good record instead of an error.
    const silent = settledFor.current === accountId;
    if (!silent) {
      setLoading(true);
      setLoadError(null);
      setRecord((current) => current.accountId === accountId ? current : { accountId, value: null });
    }
    try {
      const { data, error } = await supabase.from('loved_ones').select('*').eq('account_id', accountId).maybeSingle();
      if (error) throw error;
      if (scopeRef.current === scope && scope.request === request) {
        setRecord({ accountId, value: (data as LovedOne) ?? null });
        setLoadError(null);
        settledFor.current = accountId;
        rememberBereaved(accountId, isBereaved(data as LovedOne | null));
      }
    } catch (error) {
      if (!silent && scopeRef.current === scope && scope.request === request) setLoadError(error);
      throw error;
    } finally {
      if (!silent && scopeRef.current === scope && scope.request === request) setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void load().catch(captureAppError);
    return () => { scopeRef.current = { accountId: scopeRef.current.accountId, request: 0 }; };
  }, [load]);

  const save = useCallback(async (input: LovedOneInput): Promise<LovedOne> => {
    const scope = scopeRef.current;
    if (!accountId || scope.accountId !== accountId) throw new Error('Cannot save a loved one without the active account');
    const request = ++scope.request;
    // A failed save is the caller's to show (it rethrows); `loadError` stays
    // about the read, so Today does not treat the saved record as unreadable.
    try {
      const { data, error } = await supabase.from('loved_ones')
        .upsert({ ...input, account_id: accountId, updated_at: new Date().toISOString() }, { onConflict: 'account_id' })
        .select('*').single();
      const saved = requireSavedData(data as LovedOne | null, error, 'Loved-one save returned no data');
      if (scopeRef.current === scope && scope.request === request) setRecord({ accountId, value: saved });
      return saved;
    } finally {
      if (scopeRef.current === scope && scope.request === request) setLoading(false);
    }
  }, [accountId]);

  const setStatus = useCallback(async (status: LovedOneStatus): Promise<void> => {
    const scope = scopeRef.current;
    if (!accountId || scope.accountId !== accountId) throw new Error('Cannot update status without the active account');
    const request = ++scope.request;
    // Do not claim success locally when the RPC rejects the change.
    try {
      const { error } = await supabase.rpc('set_loved_one_status', { p_status: status });
      if (error) throw error;
      if (scopeRef.current === scope && scope.request === request) await load();
    } finally {
      if (scopeRef.current === scope && scope.request === request) setLoading(false);
    }
  }, [accountId, load]);

  // "They died": her own account only (the RPC reads the signed-in account).
  // `contact` lets an admin know so someone can reach out.
  const markDied = useCallback(async (contact: boolean): Promise<void> => {
    if (!accountId || scopeRef.current.accountId !== accountId) throw new Error('Cannot update without the active account');
    const { error } = await supabase.rpc('mark_loved_one_died', { p_contact: contact });
    if (error) throw error;
    rememberBereaved(accountId, true);
    setCached({ accountId, bereaved: true });
    await load().catch(() => undefined);
  }, [accountId, load]);

  const clearDied = useCallback(async (): Promise<void> => {
    if (!accountId || scopeRef.current.accountId !== accountId) throw new Error('Cannot update without the active account');
    const { error } = await supabase.rpc('clear_loved_one_died');
    if (error) throw error;
    rememberBereaved(accountId, false);
    setCached({ accountId, bereaved: false });
    await load().catch(() => undefined);
  }, [accountId, load]);

  const settled = !loading && !loadError && record.accountId === accountId;
  const cachedBereaved = cached.accountId === accountId ? cached.bereaved : undefined;
  return {
    lovedOne: record.accountId === accountId ? record.value : null,
    /**
     * Her loved one died: the loaded record decides; until it loads (or when
     * offline) the device's copy does. undefined only before either is known.
     */
    bereaved: settled ? isBereaved(record.value) : cachedBereaved,
    loading: loading || record.accountId !== accountId,
    loadError, save, setStatus, markDied, clearDied, refresh: load,
  };
}
