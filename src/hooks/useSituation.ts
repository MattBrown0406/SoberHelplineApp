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
  // False while the band is only the default (not yet read, or the read
  // failed); callers must not act on the default drivers as if they were real.
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (isCancelled: () => boolean = () => false) => {
    if (!accountId) {
      setSituation(DEFAULT_SITUATION);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc('my_situation');
    // A response for a previous account must not land on the next one.
    if (isCancelled()) return;
    if (!error && data) {
      setSituation(data as Situation);
      setLoaded(true);
    }
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    let cancelled = false;
    // Never carry one account's crisis band into another account's session.
    setSituation(DEFAULT_SITUATION);
    setLoaded(false);
    void load(() => cancelled);
    return () => { cancelled = true; };
  }, [load]);

  return { situation, loading, loaded, refresh: load };
}
