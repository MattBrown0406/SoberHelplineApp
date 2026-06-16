import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const QUOTE_COUNT = 14;
const FOCUS_POOL_COUNT = 7;

export interface TodayFeedData {
  dayCount: number;
  boundariesHeld: number;
  groupSessions: number;
  quoteIndex: number;
  focusSlot: number;
  scriptSlot: number;
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!accountId) {
      setLoading(false);
      return;
    }
    void load();
  }, [accountId]);

  async function load() {
    setLoading(true);

    const [wallsRes, rsvpRes] = await Promise.all([
      supabase.from('walls').select('*', { count: 'exact', head: true }),
      supabase
        .from('session_rsvps')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'going'),
    ]);

    const now = new Date();
    const doy = dayOfYear(now);

    setBoundariesHeld(wallsRes.count ?? 0);
    setGroupSessions(rsvpRes.count ?? 0);
    setQuoteIndex(doy % QUOTE_COUNT);
    setFocusSlot(doy % FOCUS_POOL_COUNT);
    setScriptSlot(doy % 14);
    setDayCount(
      joinedAt
        ? Math.max(1, Math.floor((now.getTime() - new Date(joinedAt).getTime()) / 86400000) + 1)
        : 1,
    );
    setLoading(false);
  }

  return { dayCount, boundariesHeld, groupSessions, quoteIndex, focusSlot, scriptSlot, loading };
}

function dayOfYear(d: Date): number {
  return Math.floor(
    (d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000,
  );
}
