import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { reserveFamilySquares, familySquaresRsvpIsCurrent, FAMILY_SQUARES_ALREADY_REGISTERED } from '../lib/familySquaresRegistration';
import { declineFamilySquares } from '../lib/familySquaresSeat';
import {
  DEFAULT_SITUATION,
  funnelDoor,
  type FunnelDoor,
  type Situation,
} from '../lib/situation';
import {
  curriculumWeek,
  isBeyondAuthoredCurriculum,
  phaseForWeek,
} from '../content/curriculum';
import type { CurriculumPhase } from '../api/types';
import { chooseFreeCall, isLaSobremesaSession, isFamilySquaresSession } from '../lib/familySquaresSchedule';
import { reserveLaSobremesa, withPersonalLinks } from '../lib/laSobremesa';
import { withFreshAnswer } from '../lib/freshAnswer';
import { appAlert } from '../lib/appAlert';
import i18n from 'i18next';
import { useTranslation } from 'react-i18next';

const QUOTE_COUNT = 14;

/** The weekly free group call surfaced as the daily anchor on Today. */
export interface FreeCall {
  id: string;
  title: string;
  schedule_label: string;
  next_at: string | null;
  zoom_url: string | null;
  rsvped: boolean;
  /** Family Squares only: she answered "can't make it" for this meeting. */
  declined?: boolean;
}

export interface TodayFeedData {
  dayCount: number;
  boundariesHeld: number;
  groupSessions: number;
  quoteIndex: number;
  scriptSlot: number;
  /** 1-based week in the family's own arc. Advances; never wraps. */
  curriculumWeek: number;
  curriculumPhase: CurriculumPhase;
  /** True once the family has run past the authored curriculum. */
  beyondCurriculum: boolean;
  situation: Situation;
  primaryDoor: FunnelDoor;
  nextFreeCall: FreeCall | null;
  rsvpFreeCall: () => Promise<void>;
  /** "Can't make it this week" for Family Squares; false when it was not saved. */
  declineFreeCall: () => Promise<boolean>;
  /** Re-read the feed (e.g. after the loved one's phase or status changed). */
  reload: () => Promise<void>;
  loading: boolean;
}

export function useTodayFeed(
  accountId: string | null,
  joinedAt: string | null,
): TodayFeedData {
  const [dayCount, setDayCount] = useState(1);
  const [boundariesHeld, setBoundariesHeld] = useState(0);
  const [groupSessions, setGroupSessions] = useState(0);
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [scriptSlot, setScriptSlot] = useState(0);
  const [situation, setSituation] = useState<Situation>(DEFAULT_SITUATION);
  const [situationAccountId, setSituationAccountId] = useState<string | null>(null);
  const [week, setWeek] = useState(1);
  const [nextFreeCall, setNextFreeCall] = useState<FreeCall | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  // The account whose feed last loaded without an error.
  const loadedFor = useRef<string | null>(null);
  const identity = useRef(accountId);
  identity.current = accountId;
  useEffect(() => () => { identity.current = null; }, []);
  // Goes up with every answer she gives (seat saved, "can't make it", RSVP):
  // a read that began before it must not put the old answer back (freshAnswer).
  const answers = useRef(0);
  // True while an RSVP write (or a registration) is on its way to the server.
  const reserving = useRef(false);

  const load = useCallback(async () => {
    const request = ++generation.current;
    const answersAtStart = answers.current;
    if (!accountId) {
      setSituation(DEFAULT_SITUATION);
      setSituationAccountId(null);
      setBoundariesHeld(0);
      setGroupSessions(0);
      setNextFreeCall(null);
      setLoading(false);
      return;
    }
    setLoading(true);

    const [wallsRes, rsvpCountRes, sessRes, rsvpRowsRes, sitRes] = await Promise.all([
      supabase.from('walls').select('*', { count: 'exact', head: true }),
      supabase
        .from('session_rsvps')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'going'),
      supabase
        .from('sessions')
        .select('id, title, schedule_label, next_at, zoom_url')
        .eq('kind', 'group')
        .order('next_at', { ascending: true }),
      // "Can't make it" answers too: the card says so instead of offering the seat as new.
      supabase.from('session_rsvps').select('session_id, status, family_squares_meeting_date').in('status', ['going', 'declined']).eq('account_id', accountId!),
      supabase.rpc('my_situation'),
    ]);

    if (request !== generation.current) return;
    // A failed read (offline resume, dead zone) keeps what this account last
    // loaded: blanking it would drop her saved seat and, for a family in a
    // crisis week, the support doors. The first load still falls back.
    const failed = [wallsRes, rsvpCountRes, sessRes, rsvpRowsRes, sitRes].some((res) => res.error);
    if (failed && loadedFor.current === accountId) {
      setLoading(false);
      return;
    }

    const now = new Date();
    const doy = dayOfYear(now);

    setBoundariesHeld(wallsRes.count ?? 0);
    // (A count read before an answer she has since given would be one out.)
    if (answersAtStart === answers.current && !reserving.current) setGroupSessions(rsvpCountRes.count ?? 0);
    setQuoteIndex(doy % QUOTE_COUNT);
    setScriptSlot(doy % 14);
    setDayCount(
      joinedAt
        ? Math.max(1, Math.floor((now.getTime() - new Date(joinedAt).getTime()) / 86400000) + 1)
        : 1,
    );
    // The curriculum week advances with the family's own arc — unlike the
    // day-of-year slots above, it never wraps back to the start.
    setWeek(curriculumWeek(joinedAt, now));

    if (sitRes.data) {
      setSituation(sitRes.data as Situation);
      setSituationAccountId(accountId);
    } else {
      setSituation(DEFAULT_SITUATION);
      setSituationAccountId(accountId);
    }

    // Next free call: The Family Squares during its live hour, else the
    // soonest upcoming group session, else the soonest overall.
    // La Sobremesa's Join opens the member's personal link.
    const groups = await withPersonalLinks((sessRes.data ?? []) as Omit<FreeCall, 'rsvped'>[]);
    if (request !== generation.current) return;
    const going = new Set((rsvpRowsRes.data ?? []).filter((r) => r.status === 'going').map((r) => r.session_id as string));
    const chosen = chooseFreeCall(groups, now);
    // A Family Squares answer counts only for the meeting it was given for.
    const answer = chosen && isFamilySquaresSession(chosen)
      ? rsvpRowsRes.data?.find((r) => r.session_id === chosen.id)
      : undefined;
    const answerIsCurrent = familySquaresRsvpIsCurrent(answer?.family_squares_meeting_date, now);
    const loadedCall: FreeCall | null = chosen ? { ...chosen,
      rsvped: isFamilySquaresSession(chosen) ? answerIsCurrent && answer?.status === 'going' : going.has(chosen.id),
      declined: answerIsCurrent && answer?.status === 'declined' } : null;
    // She answered while this read was in flight (or the answer is still
    // being saved): her answer stays as it is.
    const answeredSince = answersAtStart !== answers.current || reserving.current;
    setNextFreeCall((prev) => (loadedCall ? withFreshAnswer(loadedCall, prev, answeredSince) : null));

    if (!failed) loadedFor.current = accountId;
    setLoading(false);
  }, [accountId, joinedAt]);

  // The server shows the Monday call in the member's language: reload when it changes.
  const { i18n: i18nInstance } = useTranslation();
  const language = i18nInstance.language;
  useEffect(() => {
    void load();
    return () => { ++generation.current; };
  }, [load, language]);

  // Refetch when the screen regains focus so an admin-updated Zoom link (or
  // fresh RSVP counts) reach members whose app was already open.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  // Focus does not fire when the app returns to a Today that was already in
  // view (a push tap the next morning): re-read on foreground too, so a seat
  // cleared by the Tuesday reset is not still shown as saved.
  useEffect(() => {
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => appState.remove();
  }, [load]);

  const rsvpFreeCall = useCallback(async () => {
    if (!accountId || !nextFreeCall) return;
    // One RSVP write (or La Sobremesa registration, which can take seconds) at a time.
    if (reserving.current) return;
    const wasRsvped = nextFreeCall.rsvped;
    if (isFamilySquaresSession(nextFreeCall)) {
      reserving.current = true;
      const reserved = await reserveFamilySquares(accountId).finally(() => { reserving.current = false; });
      if (identity.current !== accountId) return;
      if (!reserved.ok) {
        appAlert(i18n.t('support:sessions.rsvpErrorTitle'), i18n.t('support:sessions.rsvpErrorBody'));
        return;
      }
      ++answers.current;
      setNextFreeCall((prev) => prev?.id === nextFreeCall.id ? { ...prev, rsvped: true, declined: false } : prev);
      // A legacy/stale going row already contributes to the total even when
      // this occurrence was not registered. Ensure may update, not insert it.
      try {
        const { count, error } = await supabase
          .from('session_rsvps')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'going');
        if (identity.current !== accountId) return;
        if (error || count === null) throw error ?? new Error('Missing RSVP count');
        setGroupSessions(count);
      } catch (error) {
        // Registration succeeded; keep the last known total until a reload
        // rather than inventing a count or reporting registration failure.
        console.warn('Could not refresh Today session count after registration', error);
      }
      if (identity.current !== accountId) return;
      if (reserved.alreadyRegistered) appAlert(i18n.t(FAMILY_SQUARES_ALREADY_REGISTERED));
      return;
    }
    // Reserving La Sobremesa registers with AyudaSobria for a personal link.
    // Also when "going" but without a link (e.g. RSVP'd from an older app build).
    if (isLaSobremesaSession(nextFreeCall) && (!wasRsvped || !nextFreeCall.zoom_url)) {
      reserving.current = true;
      const reserved = await reserveLaSobremesa().finally(() => {
        reserving.current = false;
      });
      if (!reserved.ok) {
        appAlert(
          i18n.t('support:sessions.rsvpErrorTitle'),
          i18n.t(reserved.reason === 'not_available' ? 'common:laSobremesa.notAvailable' : 'support:sessions.rsvpErrorBody'),
        );
        return;
      }
      ++answers.current;
      setNextFreeCall((prev) => (prev ? { ...prev, rsvped: true, zoom_url: reserved.joinUrl } : prev));
      if (!wasRsvped) setGroupSessions((c) => c + 1);
      return;
    }
    ++answers.current;
    setNextFreeCall((prev) => (prev ? { ...prev, rsvped: !prev.rsvped } : prev));
    setGroupSessions((c) => Math.max(0, c + (wasRsvped ? -1 : 1)));
    reserving.current = true;
    let failed = false;
    try {
      const result = wasRsvped
        ? await supabase
            .from('session_rsvps')
            .delete()
            .eq('session_id', nextFreeCall.id)
            .eq('account_id', accountId)
        : await supabase.from('session_rsvps').upsert({
            session_id: nextFreeCall.id,
            account_id: accountId,
            status: 'going',
          });
      failed = !!result.error;
    } catch {
      failed = true;
    } finally {
      reserving.current = false;
      // Reads that began while this was saving may have seen the old answer.
      ++answers.current;
    }
    if (failed) {
      // Undo the optimistic change: a "Going" that wasn't saved gets no reminder.
      setNextFreeCall((prev) => (prev ? { ...prev, rsvped: wasRsvped } : prev));
      setGroupSessions((c) => Math.max(0, c + (wasRsvped ? 1 : -1)));
      appAlert(i18n.t('support:sessions.rsvpErrorTitle'), i18n.t('support:sessions.rsvpErrorBody'));
    }
  }, [accountId, nextFreeCall]);

  const declineFreeCall = useCallback(async (): Promise<boolean> => {
    if (!accountId || !nextFreeCall || !isFamilySquaresSession(nextFreeCall)) return false;
    // Never while a seat is being saved: the two answers must not cross.
    if (reserving.current) return false;
    reserving.current = true;
    const declined = await declineFamilySquares().finally(() => { reserving.current = false; });
    if (identity.current !== accountId || !declined) return declined;
    ++answers.current;
    setNextFreeCall((prev) => prev?.id === nextFreeCall.id ? { ...prev, rsvped: false, declined: true } : prev);
    // One fewer "going" in the count Today shows.
    setGroupSessions((c) => Math.max(0, c - 1));
    return true;
  }, [accountId, nextFreeCall]);

  const visibleSituation = situationAccountId === accountId ? situation : DEFAULT_SITUATION;

  return {
    dayCount,
    boundariesHeld,
    groupSessions,
    quoteIndex,
    scriptSlot,
    curriculumWeek: week,
    curriculumPhase: phaseForWeek(week),
    beyondCurriculum: isBeyondAuthoredCurriculum(week),
    situation: visibleSituation,
    primaryDoor: funnelDoor(visibleSituation),
    nextFreeCall,
    rsvpFreeCall,
    declineFreeCall,
    reload: load,
    loading,
  };
}

function dayOfYear(d: Date): number {
  return Math.floor(
    (d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000,
  );
}
