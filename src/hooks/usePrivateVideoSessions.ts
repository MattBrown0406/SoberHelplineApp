import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type PrivateVideoSession = {
  id: string;
  account_id: string;
  room_name: string;
  status: 'requested' | 'scheduled' | 'live' | 'completed' | 'cancelled';
  scheduled_for: string | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

export function usePrivateVideoSessions(accountId: string | null, canAccess: boolean) {
  const [sessions, setSessions] = useState<PrivateVideoSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId || !canAccess) {
      setSessions([]);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await supabase
      .from('video_sessions')
      .select('id, account_id, room_name, status, scheduled_for, started_at, ended_at, created_at, updated_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (loadError) {
      const missingVideoSchema = loadError.message.includes('video_sessions') || loadError.code === 'PGRST205';
      setError(missingVideoSchema ? 'Private video setup is being finalized. Please try again shortly.' : loadError.message);
    } else setSessions((data ?? []) as PrivateVideoSession[]);
    setLoading(false);
  }, [accountId, canAccess]);

  useEffect(() => { void load(); }, [load]);

  const requestSession = useCallback(async () => {
    if (!accountId || !canAccess) return null;
    setRequesting(true);
    setError(null);
    const { data, error: requestError } = await supabase.rpc('request_private_video_session');
    setRequesting(false);
    if (requestError) {
      setError(requestError.message);
      return null;
    }
    await load();
    return data as PrivateVideoSession;
  }, [accountId, canAccess, load]);

  const activeSession = sessions.find((s) => ['requested', 'scheduled', 'live'].includes(s.status)) ?? null;

  return {
    sessions,
    activeSession,
    loading,
    requesting,
    error,
    load,
    requestSession,
  };
}
