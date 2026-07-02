import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';

export interface DbSession {
  id: string;
  kind: 'group' | 'one-on-one' | 'family';
  title: string;
  schedule_label: string;
  next_at: string | null;
  zoom_url: string | null;
  rsvped: boolean;
}

export function useSessions(accountId: string | null) {
  const [sessions, setSessions] = useState<DbSession[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data: rows }, { data: rsvps }] = await Promise.all([
      supabase
        .from('sessions')
        .select('id, kind, title, schedule_label, next_at, zoom_url')
        .order('next_at', { ascending: true }),
      supabase.from('session_rsvps').select('session_id').eq('status', 'going'),
    ]);
    const going = new Set((rsvps ?? []).map((r) => r.session_id as string));
    setSessions(
      ((rows as Omit<DbSession, 'rsvped'>[]) ?? []).map((s) => ({
        ...s,
        rsvped: going.has(s.id),
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    if (accountId) load();
  }, [accountId, load]);

  // Refetch on focus so an admin-updated Zoom link reaches already-open apps.
  useFocusEffect(
    useCallback(() => {
      if (accountId) void load();
    }, [accountId, load]),
  );

  const toggleRsvp = useCallback(
    async (session: DbSession) => {
      if (!accountId) return;
      // optimistic
      setSessions((prev) =>
        prev.map((s) => (s.id === session.id ? { ...s, rsvped: !s.rsvped } : s)),
      );
      if (session.rsvped) {
        await supabase
          .from('session_rsvps')
          .delete()
          .eq('session_id', session.id)
          .eq('account_id', accountId);
      } else {
        await supabase.from('session_rsvps').upsert({
          session_id: session.id,
          account_id: accountId,
          status: 'going',
        });
      }
    },
    [accountId],
  );

  return { sessions, loading, toggleRsvp };
}
