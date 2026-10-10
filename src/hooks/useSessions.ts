import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { isLaSobremesaSession } from '../lib/familySquaresSchedule';
import { reserveLaSobremesa, withPersonalLinks } from '../lib/laSobremesa';

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
    // La Sobremesa's Join opens the member's personal link.
    const withLinks = await withPersonalLinks((rows as Omit<DbSession, 'rsvped'>[]) ?? []);
    setSessions(
      withLinks.map((s) => ({
        ...s,
        rsvped: going.has(s.id),
      })),
    );
    setLoading(false);
  }, []);

  // The server shows the Monday call in the member's language: reload when it changes.
  const { i18n } = useTranslation();
  const language = i18n.language;
  useEffect(() => {
    if (accountId) load();
  }, [accountId, load, language]);

  // Refetch on focus so an admin-updated Zoom link reaches already-open apps.
  useFocusEffect(
    useCallback(() => {
      if (accountId) void load();
    }, [accountId, load]),
  );

  const reserving = useRef(false);

  const toggleRsvp = useCallback(
    /** true when saved; 'not_available' when La Sobremesa isn't open for reservations yet. */
    async (session: DbSession): Promise<boolean | 'not_available'> => {
      if (!accountId) return false;
      // Reserving La Sobremesa registers with AyudaSobria for a personal link.
      // Also when "going" but without a link (e.g. RSVP'd from an older app build).
      if (isLaSobremesaSession(session) && (!session.rsvped || !session.zoom_url)) {
        // One registration at a time: it can take several seconds (AyudaSobria → Zoom).
        if (reserving.current) return true;
        reserving.current = true;
        const reserved = await reserveLaSobremesa().finally(() => {
          reserving.current = false;
        });
        if (!reserved.ok) return reserved.reason === 'not_available' ? 'not_available' : false;
        setSessions((prev) =>
          prev.map((s) => (s.id === session.id ? { ...s, rsvped: true, zoom_url: reserved.joinUrl } : s)),
        );
        return true;
      }
      setSessions((prev) =>
        prev.map((s) => (s.id === session.id ? { ...s, rsvped: !s.rsvped } : s)),
      );
      try {
        const result = session.rsvped
          ? await supabase
              .from('session_rsvps')
              .delete()
              .eq('session_id', session.id)
              .eq('account_id', accountId)
          : await supabase.from('session_rsvps').upsert({
              session_id: session.id,
              account_id: accountId,
              status: 'going',
            });
        if (result.error) throw result.error;
        return true;
      } catch {
        setSessions((prev) =>
          prev.map((s) => (s.id === session.id ? { ...s, rsvped: session.rsvped } : s)),
        );
        return false;
      }
    },
    [accountId],
  );

  return { sessions, loading, toggleRsvp };
}
