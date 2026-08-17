import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
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

const QUOTE_COUNT = 14;

/** The weekly free group call surfaced as the daily anchor on Today. */
export interface FreeCall {
  id: string;
  title: string;
  schedule_label: string;
  next_at: string | null;
  zoom_url: string | null;
  rsvped: boolean;
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

  const load = useCallback(async () => {
    const request = ++generation.current;
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
      supabase.from('session_rsvps').select('session_id').eq('status', 'going'),
      supabase.rpc('my_situation'),
    ]);

    if (request !== generation.current) return;

    const now = new Date();
    const doy = dayOfYear(now);

    setBoundariesHeld(wallsRes.count ?? 0);
    setGroupSessions(rsvpCountRes.count ?? 0);
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

    // Next free call: soonest upcoming group session, else the soonest overall.
    const groups = (sessRes.data ?? []) as Omit<FreeCall, 'rsvped'>[];
    const going = new Set((rsvpRowsRes.data ?? []).map((r) => r.session_id as string));
    const upcoming = groups.find((g) => g.next_at && new Date(g.next_at) >= now);
    const chosen = upcoming ?? groups[0] ?? null;
    setNextFreeCall(chosen ? { ...chosen, rsvped: going.has(chosen.id) } : null);

    setLoading(false);
  }, [accountId, joinedAt]);

  useEffect(() => {
    void load();
    return () => { ++generation.current; };
  }, [load]);

  // Refetch when the screen regains focus so an admin-updated Zoom link (or
  // fresh RSVP counts) reach members whose app was already open.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const rsvpFreeCall = useCallback(async () => {
    if (!accountId || !nextFreeCall) return;
    const wasRsvped = nextFreeCall.rsvped;
    setNextFreeCall((prev) => (prev ? { ...prev, rsvped: !prev.rsvped } : prev));
    setGroupSessions((c) => Math.max(0, c + (wasRsvped ? -1 : 1)));
    if (wasRsvped) {
      await supabase
        .from('session_rsvps')
        .delete()
        .eq('session_id', nextFreeCall.id)
        .eq('account_id', accountId);
    } else {
      await supabase.from('session_rsvps').upsert({
        session_id: nextFreeCall.id,
        account_id: accountId,
        status: 'going',
      });
    }
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
    loading,
  };
}

function dayOfYear(d: Date): number {
  return Math.floor(
    (d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000,
  );
}
