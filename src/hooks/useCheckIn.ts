import { useState, useEffect, useCallback } from 'react';
import type { CheckIn, CheckInStreak, MoodScore } from '../api/types';
import { getCheckIn, saveCheckIn as persistLocal, getCheckedInDates, toDateStr, localDayRangeUtc } from '../storage/checkIn';
import { supabase } from '../lib/supabase';

export interface UseCheckInResult {
  todayCheckIn: CheckIn | null;
  streak: CheckInStreak;
  isLoading: boolean;
  saveCheckIn: (moodScore: MoodScore, note?: string) => Promise<void>;
}

export function useCheckIn(accountId: string | null): UseCheckInResult {
  const [todayCheckIn, setTodayCheckIn] = useState<CheckIn | null>(null);
  const [streak, setStreak] = useState<CheckInStreak>({
    currentStreak: 0,
    longestStreak: 0,
    lastCompletedDate: null,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { startIso, endIso } = localDayRangeUtc(new Date());

      if (accountId) {
        // Supabase-first: fetch today's check-in and full history from the database.
        // "Today" is the user's LOCAL calendar day, bounded as UTC instants.
        const [todayResult, historyResult] = await Promise.all([
          supabase
            .from('checkins')
            .select('id, mood, note, created_at')
            .eq('account_id', accountId)
            .gte('created_at', startIso)
            .lte('created_at', endIso)
            .maybeSingle(),
          supabase
            .from('checkins')
            .select('created_at')
            .eq('account_id', accountId)
            .order('created_at', { ascending: false }),
        ]);

        if (cancelled) return;

        if (todayResult.data) {
          const remote: CheckIn = {
            id: todayResult.data.id,
            userId: accountId,
            moodScore: todayResult.data.mood as MoodScore,
            note: todayResult.data.note ?? null,
            completedAt: todayResult.data.created_at,
            synced: true,
          };
          await persistLocal(remote);
          setTodayCheckIn(remote);
        } else {
          setTodayCheckIn(await getCheckIn(new Date()));
        }

        if (historyResult.data) {
          const dates = historyResult.data.map((r) => toDateStr(new Date(r.created_at)));
          setStreak(computeStreak(dates));
        } else {
          setStreak(computeStreak(await getCheckedInDates()));
        }
      } else {
        // Offline / pre-auth fallback
        const [existing, dates] = await Promise.all([
          getCheckIn(new Date()),
          getCheckedInDates(),
        ]);
        if (cancelled) return;
        setTodayCheckIn(existing);
        setStreak(computeStreak(dates));
      }

      setIsLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [accountId]);

  const saveCheckIn = useCallback(async (moodScore: MoodScore, note?: string) => {
    const now = new Date();
    const id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `ci-${now.getTime()}-${Math.floor(Math.random() * 1_000_000)}`;

    const checkIn: CheckIn = {
      id,
      userId: accountId ?? 'local',
      moodScore,
      note: note ?? null,
      completedAt: now.toISOString(),
      synced: false,
    };

    // 1. Optimistic local write — must succeed before anything else
    await persistLocal(checkIn);
    setTodayCheckIn(checkIn);
    const localDates = await getCheckedInDates();
    setStreak(computeStreak(localDates));

    // 2. Sync to Supabase if authenticated
    if (accountId) {
      const { error } = await supabase.from('checkins').insert({
        id: checkIn.id,
        account_id: accountId,
        mood: checkIn.moodScore,
        note: checkIn.note,
        created_at: checkIn.completedAt,
      });

      if (error) {
        console.error('[useCheckIn] Supabase insert failed:', error);
      } else {
        const synced = { ...checkIn, synced: true };
        await persistLocal(synced);
        setTodayCheckIn(synced);
      }
    }
  }, [accountId]);

  return { todayCheckIn, streak, isLoading, saveCheckIn };
}

function computeStreak(datesDesc: string[]): CheckInStreak {
  if (!datesDesc.length) {
    return { currentStreak: 0, longestStreak: 0, lastCompletedDate: null };
  }

  const today = toDateStr(new Date());
  const yesterday = toDateStr(new Date(Date.now() - 86_400_000));
  const set = new Set(datesDesc);

  let current = 0;
  const startDate = set.has(today) ? today : set.has(yesterday) ? yesterday : null;
  if (startDate) {
    const cursor = new Date(startDate + 'T12:00:00Z');
    while (set.has(toDateStr(cursor))) {
      current++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
  }

  const sorted = [...datesDesc].reverse();
  let longest = 0;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + 'T12:00:00Z');
    prev.setUTCDate(prev.getUTCDate() + 1);
    if (toDateStr(prev) === sorted[i]) {
      run++;
    } else {
      if (run > longest) longest = run;
      run = 1;
    }
  }
  if (run > longest) longest = run;

  return {
    currentStreak: current,
    longestStreak: Math.max(longest, current),
    lastCompletedDate: datesDesc[0] ?? null,
  };
}
