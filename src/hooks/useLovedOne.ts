import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

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
}

export interface LovedOneInput {
  relationship?: string | null;
  first_name?: string | null;
  substances?: string[];
  stage?: string | null;
  status?: LovedOneStatus;
}

/**
 * CRUD for the single loved-one record attached to an account. save() upserts
 * on account_id (one row per account); setStatus() bumps just the status, used
 * by the crisis/tracker off-ramps to feed the situation score.
 */
export function useLovedOne(accountId: string | null) {
  const [lovedOne, setLovedOne] = useState<LovedOne | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!accountId) {
      setLovedOne(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('loved_ones')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();
    setLovedOne((data as LovedOne) ?? null);
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (input: LovedOneInput): Promise<LovedOne | null> => {
      if (!accountId) return null;
      const { data, error } = await supabase
        .from('loved_ones')
        .upsert(
          { account_id: accountId, ...input, updated_at: new Date().toISOString() },
          { onConflict: 'account_id' },
        )
        .select('*')
        .single();
      if (error || !data) return null;
      setLovedOne(data as LovedOne);
      return data as LovedOne;
    },
    [accountId],
  );

  const setStatus = useCallback(
    async (status: LovedOneStatus): Promise<void> => {
      if (!accountId) return;
      // Optimistic; set_loved_one_status upserts so this works pre-save too.
      setLovedOne((prev) => (prev ? { ...prev, status } : prev));
      await supabase.rpc('set_loved_one_status', { p_status: status });
      await load();
    },
    [accountId, load],
  );

  return { lovedOne, loading, save, setStatus, refresh: load };
}
