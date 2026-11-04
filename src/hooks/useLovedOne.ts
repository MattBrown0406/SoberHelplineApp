import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
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

/** CRUD for the account's single loved-one record. */
export function useLovedOne(accountId: string | null) {
  const [record, setRecord] = useState<{ accountId: string | null; value: LovedOne | null }>({ accountId: null, value: null });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const scopeRef = useRef({ accountId, request: 0 });
  if (scopeRef.current.accountId !== accountId) scopeRef.current = { accountId, request: 0 };

  const load = useCallback(async () => {
    const scope = scopeRef.current;
    if (scope.accountId !== accountId) return;
    const request = ++scope.request;
    if (!accountId) {
      setRecord({ accountId, value: null });
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    setRecord((current) => current.accountId === accountId ? current : { accountId, value: null });
    try {
      const { data, error } = await supabase.from('loved_ones').select('*').eq('account_id', accountId).maybeSingle();
      if (error) throw error;
      if (scopeRef.current === scope && scope.request === request) {
        setRecord({ accountId, value: (data as LovedOne) ?? null });
      }
    } catch (error) {
      if (scopeRef.current === scope && scope.request === request) setLoadError(error);
      throw error;
    } finally {
      if (scopeRef.current === scope && scope.request === request) setLoading(false);
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
    await load();
  }, [accountId, load]);

  const clearDied = useCallback(async (): Promise<void> => {
    if (!accountId || scopeRef.current.accountId !== accountId) throw new Error('Cannot update without the active account');
    const { error } = await supabase.rpc('clear_loved_one_died');
    if (error) throw error;
    await load();
  }, [accountId, load]);

  return {
    lovedOne: record.accountId === accountId ? record.value : null,
    loading: loading || record.accountId !== accountId,
    loadError, save, setStatus, markDied, clearDied, refresh: load,
  };
}
