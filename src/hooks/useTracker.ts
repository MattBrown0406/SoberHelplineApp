import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getWeekStart } from '../lib/trackerWeek';

const WARNING_TOTAL = 7;
const RECOVERY_TOTAL = 10;

export function useTracker(accountId: string | null, timezone?: string) {
  const [activeWarning, setActiveWarning] = useState<Set<string>>(new Set());
  const [activeRecovery, setActiveRecovery] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const week = getWeekStart(new Date(), timezone);

  useEffect(() => {
    if (!accountId) {
      setIsLoading(false);
      return;
    }
    supabase
      .from('tracker_logs')
      .select('sign_key, kind')
      .eq('account_id', accountId)
      .eq('week', week)
      .then(({ data }) => {
        if (data) {
          setActiveWarning(
            new Set(data.filter((r) => r.kind === 'warning').map((r) => r.sign_key)),
          );
          setActiveRecovery(
            new Set(data.filter((r) => r.kind === 'recovery').map((r) => r.sign_key)),
          );
        }
        setIsLoading(false);
      });
  }, [accountId, week]);

  /** Resolves false (and restores the sign) when the change could not be saved. */
  const toggleSign = useCallback(
    async (signKey: string, kind: 'warning' | 'recovery'): Promise<boolean> => {
      const isWarning = kind === 'warning';
      const current = isWarning ? activeWarning : activeRecovery;
      const setActive = isWarning ? setActiveWarning : setActiveRecovery;
      const isActive = current.has(signKey);

      setActive((prev) => {
        const next = new Set(prev);
        if (isActive) next.delete(signKey);
        else next.add(signKey);
        return next;
      });

      if (!accountId) return true;

      const { error } = isActive
        ? await supabase
          .from('tracker_logs')
          .delete()
          .eq('account_id', accountId)
          .eq('sign_key', signKey)
          .eq('week', week)
        : await supabase
          .from('tracker_logs')
          .upsert(
            { account_id: accountId, sign_key: signKey, kind, week },
            { onConflict: 'account_id,sign_key,week' },
          );
      if (!error) return true;

      setActive((prev) => {
        const next = new Set(prev);
        if (isActive) next.add(signKey);
        else next.delete(signKey);
        return next;
      });
      return false;
    },
    [accountId, activeWarning, activeRecovery, week],
  );

  const warningLevel = Math.round((activeWarning.size / WARNING_TOTAL) * 100);
  const recoveryMomentum = Math.round((activeRecovery.size / RECOVERY_TOTAL) * 100);

  return {
    activeWarning,
    activeRecovery,
    toggleSign,
    warningLevel,
    recoveryMomentum,
    isLoading,
  };
}
