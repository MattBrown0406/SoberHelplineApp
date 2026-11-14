import { useCallback, useEffect, useRef, useState } from 'react';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { appAlert } from '../lib/appAlert';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { reserveFamilySquares, familySquaresRsvpIsCurrent, FAMILY_SQUARES_ALREADY_REGISTERED } from '../lib/familySquaresRegistration';
import { declineFamilySquares } from '../lib/familySquaresSeat';
import { isLaSobremesaSession, isFamilySquaresSession } from '../lib/familySquaresSchedule';
import { reserveLaSobremesa, withPersonalLinks } from '../lib/laSobremesa';
import { withFreshAnswer } from '../lib/freshAnswer';

export interface DbSession {
  id: string;
  kind: 'group' | 'one-on-one' | 'family';
  title: string;
  schedule_label: string;
  next_at: string | null;
  zoom_url: string | null;
  rsvped: boolean;
  /** Family Squares only: she answered "can't make it" for this meeting. */
  declined?: boolean;
}

export function useSessions(accountId: string | null) {
  const [sessions, setSessions] = useState<DbSession[]>([]);
  const [loading, setLoading] = useState(true);
  const identity = useRef(accountId);
  identity.current = accountId;
  const generation = useRef(0);
  useEffect(() => () => { identity.current = null; ++generation.current; }, []);
  // Goes up with every answer she gives (seat saved, "can't make it", RSVP):
  // a read that began before it must not put the old answer back (freshAnswer).
  const answers = useRef(0);
  // How many plain RSVP writes are on their way to the server right now.
  const writing = useRef(0);

  const load = useCallback(async () => {
    const request = ++generation.current;
    const answersAtStart = answers.current;
    if (!accountId) return;
    const [{ data: rows }, { data: rsvps }] = await Promise.all([
      supabase
        .from('sessions')
        .select('id, kind, title, schedule_label, next_at, zoom_url')
        .order('next_at', { ascending: true }),
      // "Can't make it" answers too: the row says so instead of offering the seat as new.
      supabase.from('session_rsvps').select('session_id, status, family_squares_meeting_date').in('status', ['going', 'declined']).eq('account_id', accountId!),
    ]);
    const going = new Set((rsvps ?? []).filter((r) => r.status === 'going').map((r) => r.session_id as string));
    // La Sobremesa's Join opens the member's personal link.
    const withLinks = await withPersonalLinks((rows as Omit<DbSession, 'rsvped' | 'declined'>[]) ?? []);
    if (request !== generation.current || identity.current !== accountId) return;
    const loaded: DbSession[] = withLinks.map((s) => {
      if (!isFamilySquaresSession(s)) return { ...s, rsvped: going.has(s.id) };
      // A Family Squares answer counts only for the meeting it was given for.
      const answer = rsvps?.find((r) => r.session_id === s.id);
      const current = familySquaresRsvpIsCurrent(answer?.family_squares_meeting_date);
      return { ...s, rsvped: current && answer?.status === 'going', declined: current && answer?.status === 'declined' };
    });
    // She answered while this read was in flight (or an answer is still being
    // saved): her answers stay as they are.
    const answeredSince = answersAtStart !== answers.current || writing.current > 0;
    setSessions((prev) => loaded.map((s) => withFreshAnswer(s, prev.find((p) => p.id === s.id), answeredSince)));
    setLoading(false);
  }, [accountId]);

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
      if (!accountId || identity.current !== accountId) return false;
      if (isFamilySquaresSession(session)) {
        if (reserving.current) return true;
        reserving.current = true;
        const reserved = await reserveFamilySquares(accountId).finally(() => { reserving.current = false; });
        if (identity.current !== accountId) return true;
        if (!reserved.ok) return false;
        ++answers.current;
        setSessions((prev) => prev.map((s) => s.id === session.id ? { ...s, rsvped: true, declined: false } : s));
        if (reserved.alreadyRegistered) appAlert(i18next.t(FAMILY_SQUARES_ALREADY_REGISTERED));
        return true;
      }
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
        ++answers.current;
        setSessions((prev) =>
          prev.map((s) => (s.id === session.id ? { ...s, rsvped: true, zoom_url: reserved.joinUrl } : s)),
        );
        return true;
      }
      ++answers.current;
      ++writing.current;
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
      } finally {
        --writing.current;
        // Reads that began while this was saving may have seen the old answer.
        ++answers.current;
      }
    },
    [accountId],
  );

  /** "Can't make it this week" for Family Squares; false when it was not saved. */
  const declineRsvp = useCallback(async (session: DbSession): Promise<boolean> => {
    if (!accountId || identity.current !== accountId || !isFamilySquaresSession(session)) return false;
    // Never while a seat is being saved: the two answers must not cross.
    if (reserving.current) return false;
    reserving.current = true;
    const declined = await declineFamilySquares().finally(() => { reserving.current = false; });
    if (identity.current !== accountId || !declined) return declined;
    ++answers.current;
    setSessions((prev) => prev.map((s) => s.id === session.id ? { ...s, rsvped: false, declined: true } : s));
    return true;
  }, [accountId]);

  return { sessions, loading, toggleRsvp, declineRsvp };
}
