import { useCallback, useEffect, useRef, useState } from 'react';
import type { LovedOneProfile } from '../lib/lovedOneProfile';
import { fetchLovedOneProfile } from '../lib/invitationApi';
import { captureAppError } from '../lib/monitoring';

/**
 * The family's pattern map (Invitation Engine), stored server-side in
 * loved_one_profiles (owner-only RLS). Conversation practice reads it through
 * this hook and treats null as "not set up yet". A failed reload keeps the
 * last good profile for the same account rather than blanking it.
 */
export function useLovedOneProfile(accountId: string | null): {
  profile: LovedOneProfile | null;
  loading: boolean;
  reload: () => Promise<void>;
} {
  const [record, setRecord] = useState<{ accountId: string | null; profile: LovedOneProfile | null }>({
    accountId: null,
    profile: null,
  });
  const [loading, setLoading] = useState(accountId !== null);
  const request = useRef(0);

  const reload = useCallback(async () => {
    const id = ++request.current;
    if (!accountId) {
      setRecord({ accountId: null, profile: null });
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const profile = await fetchLovedOneProfile(accountId);
      if (id === request.current) setRecord({ accountId, profile });
    } catch (error) {
      captureAppError(error);
      if (id === request.current) {
        setRecord((current) => (current.accountId === accountId ? current : { accountId, profile: null }));
      }
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void reload();
    return () => { request.current += 1; };
  }, [reload]);

  return {
    profile: record.accountId === accountId ? record.profile : null,
    loading: loading || record.accountId !== accountId,
    reload,
  };
}
