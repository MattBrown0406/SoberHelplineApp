import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  DEFAULT_SITUATION,
  funnelDoor,
  type FunnelDoor,
  type Situation,
} from '../lib/situation';

const QUOTE_COUNT = 14;
const FOCUS_POOL_COUNT = 7;

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
  focusSlot: number;
  scriptSlot: number;
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
  const [focusSlot, setFocusSlot] = useState(0);
  const [scriptSlot, setScriptSlot] = useState(0);
  const [situation, setSituation] = useState<Situation>(DEFAULT_SITUATION);
  const [nextFreeCall, setNextFreeCall] = useState<FreeCall | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!accountId) {
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

    const now = new Date();
    const doy = dayOfYear(now);

    setBoundariesHeld(wallsRes.count ?? 0);
    setGroupSessions(rsvpCountRes.count ?? 0);
    setQuoteIndex(doy % QUOTE_COUNT);
    setFocusSlot(doy % FOCUS_POOL_COUNT);
    setScriptSlot(doy % 14);
    setDayCount(
      joinedAt
        ? Math.max(1, Math.floor((now.getTime() - new Date(joinedAt).getTime()) / 86400000) + 1)
        : 1,
    );

    if (sitRes.data) setSituation(sitRes.data as Situation);

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
  }, [load]);

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

  return {
    dayCount,
    boundariesHeld,
    groupSessions,
    quoteIndex,
    focusSlot,
    scriptSlot,
    situation,
    primaryDoor: funnelDoor(situation),
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
