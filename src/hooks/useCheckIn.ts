import { useState, useEffect, useCallback } from 'react';
import type { CheckIn, CheckInStreak, MoodScore } from '../api/types';
import { getCheckIn, saveCheckIn as persist, getCheckedInDates, toDateStr } from '../storage/checkIn';

export interface UseCheckInResult {
  todayCheckIn: CheckIn | null;
  streak: CheckInStreak;
  isLoading: boolean;
  /** Persists today's check-in locally. Designed to accept a sync callback later. */
  saveCheckIn: (moodScore: MoodScore, note?: string) => Promise<void>;
}

export function useCheckIn(): UseCheckInResult {
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
      const [existing, dates] = await Promise.all([
        getCheckIn(new Date()),
        getCheckedInDates(),
      ]);
      if (cancelled) return;
      setTodayCheckIn(existing);
      setStreak(computeStreak(dates));
      setIsLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const saveCheckIn = useCallback(async (moodScore: MoodScore, note?: string) => {
    const now = new Date();
    const checkIn: CheckIn = {
      id: `ci-${now.getTime()}`,
      userId: 'local', // replaced by real userId when sync layer is added
      moodScore,
      note: note ?? null,
      completedAt: now.toISOString(),
      synced: false,
    };
    await persist(checkIn);
    setTodayCheckIn(checkIn);
    const dates = await getCheckedInDates();
    setStreak(computeStreak(dates));
    // TODO: enqueue sync to POST /check-ins, flip synced: true on success
  }, []);

  return { todayCheckIn, streak, isLoading, saveCheckIn };
}

function computeStreak(datesDesc: string[]): CheckInStreak {
  if (!datesDesc.length) {
    return { currentStreak: 0, longestStreak: 0, lastCompletedDate: null };
  }

  const today = toDateStr(new Date());
  const yesterday = toDateStr(new Date(Date.now() - 86_400_000));
  const set = new Set(datesDesc);

  // Current streak: count backwards from today (or yesterday if today not yet done)
  let current = 0;
  const startDate = set.has(today) ? today : set.has(yesterday) ? yesterday : null;
  if (startDate) {
    // Use noon UTC to avoid DST edge cases when stepping back one day at a time
    const cursor = new Date(startDate + 'T12:00:00Z');
    while (set.has(toDateStr(cursor))) {
      current++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
  }

  // Longest streak: walk the sorted-ascending list
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
