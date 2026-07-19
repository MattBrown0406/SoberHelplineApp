import { useState, useEffect, useCallback } from 'react';
import type { CheckIn, CheckInStreak, MoodScore } from '../api/types';
import { getCheckIn, saveCheckIn as persistLocal, getCheckedInDates, toDateStr } from '../storage/checkIn';
import { supabase } from '../lib/supabase';
import { rearmDailyNudge } from './usePushNotifications';

export interface UseCheckInResult {
  todayCheckIn: CheckIn | null;
  streak: CheckInStreak;
  isLoading: boolean;
  saveCheckIn: (moodScore: MoodScore, note?: string) => Promise<void>;
}

export function useCheckIn(accountId: string | null, timezone?: string): UseCheckInResult {
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
      setIsLoading(true);
      const storageOwner = accountId ?? 'local';
      const today = toDateStr(new Date(), timezone);

      if (accountId) {
        const [todayResult, historyResult] = await Promise.all([
          supabase
            .from('checkins')
            .select('id, mood, note, created_at, checkin_date')
            .eq('account_id', accountId)
            .eq('checkin_date', today)
            .maybeSingle(),
          supabase
            .from('checkins')
            .select('checkin_date')
            .eq('account_id', accountId)
            .order('checkin_date', { ascending: false }),
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
          await persistLocal(remote, timezone);
          if (cancelled) return;
          setTodayCheckIn(remote);
        } else {
          const localToday = await getCheckIn(accountId, new Date(), timezone);
          if (cancelled) return;
          setTodayCheckIn(localToday);
        }

        if (historyResult.data) {
          setStreak(computeStreak(historyResult.data.map((row) => row.checkin_date), timezone));
        } else {
          const localDates = await getCheckedInDates(accountId);
          if (cancelled) return;
          setStreak(computeStreak(localDates, timezone));
        }
      } else {
        const [existing, dates] = await Promise.all([
          getCheckIn(storageOwner, new Date(), timezone),
          getCheckedInDates(storageOwner),
        ]);
        if (cancelled) return;
        setTodayCheckIn(existing);
        setStreak(computeStreak(dates, timezone));
      }

      if (!cancelled) setIsLoading(false);
    }
    void load().catch(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [accountId, timezone]);

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

    await persistLocal(checkIn, timezone);
    setTodayCheckIn(checkIn);
    const localDates = await getCheckedInDates(checkIn.userId);
    setStreak(computeStreak(localDates, timezone));
    void rearmDailyNudge();

    if (accountId) {
      const { error } = await supabase.from('checkins').insert({
        id: checkIn.id,
        account_id: accountId,
        mood: checkIn.moodScore,
        note: checkIn.note,
        created_at: checkIn.completedAt,
        checkin_date: toDateStr(now, timezone),
      });

      if (error) {
        console.error('[useCheckIn] Supabase insert failed:', error);
        throw error;
      }

      const synced = { ...checkIn, synced: true };
      await persistLocal(synced, timezone);
      setTodayCheckIn(synced);
    }
  }, [accountId, timezone]);

  return { todayCheckIn, streak, isLoading, saveCheckIn };
}

function computeStreak(datesDesc: string[], timezone?: string): CheckInStreak {
  if (!datesDesc.length) {
    return { currentStreak: 0, longestStreak: 0, lastCompletedDate: null };
  }

  const today = toDateStr(new Date(), timezone);
  const yesterday = toDateStr(new Date(Date.now() - 86_400_000), timezone);
  const set = new Set(datesDesc);

  let current = 0;
  let graceConsumed = false;
  let countAtGrace = 0;
  const startDate = set.has(today) ? today : set.has(yesterday) ? yesterday : null;
  if (startDate) {
    const cursor = new Date(startDate + 'T12:00:00Z');
    while (true) {
      if (set.has(cursor.toISOString().slice(0, 10))) {
        current++;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
      } else if (!graceConsumed) {
        graceConsumed = true;
        countAtGrace = current;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
      } else {
        break;
      }
    }
  }
  const graceUsed = graceConsumed && current > countAtGrace;

  const sorted = [...new Set(datesDesc)].sort();
  let longest = sorted.length ? 1 : 0;
  let run = sorted.length ? 1 : 0;
  for (let i = 1; i < sorted.length; i++) {
    const previous = new Date(sorted[i - 1] + 'T12:00:00Z');
    previous.setUTCDate(previous.getUTCDate() + 1);
    if (previous.toISOString().slice(0, 10) === sorted[i]) run++;
    else run = 1;
    if (run > longest) longest = run;
  }

  return {
    currentStreak: current,
    longestStreak: Math.max(longest, current),
    lastCompletedDate: datesDesc[0] ?? null,
    graceUsed,
  };
}
