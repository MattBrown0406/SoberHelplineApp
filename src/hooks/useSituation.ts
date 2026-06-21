import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { DEFAULT_SITUATION, type Situation } from '../lib/situation';

/**
 * Reads the caller's current situation band from the my_situation() RPC.
 * Returns a safe default (calm) while loading or if the account isn't resolved.
 */
export function useSituation(accountId: string | null) {
  const [situation, setSituation] = useState<Situation>(DEFAULT_SITUATION);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!accountId) {
      setSituation(DEFAULT_SITUATION);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc('my_situation');
    if (!error && data) {
      setSituation(data as Situation);
    }
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { situation, loading, refresh: load };
}
