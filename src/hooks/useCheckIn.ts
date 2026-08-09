import { useState, useEffect, useCallback, useRef } from 'react';
import { randomUUID } from 'expo-crypto';
import type { CaregiverCheckInInput, CheckIn, CheckInStreak, MoodScore } from '../api/types';
import { getCheckIn, saveCheckIn as persistLocal, getCheckedInDates, toDateStr } from '../storage/checkIn';
import { supabase } from '../lib/supabase';
import { createCheckInId, persistDailyCheckIn, mergeCheckInDates } from '../lib/checkInPersistence';
import { captureAppError } from '../lib/monitoring';
import { isMoodScore, parseSupportNeed } from '../lib/caregiverCheckIn';
import { rearmDailyNudge } from './usePushNotifications';

export interface UseCheckInResult {
  todayCheckIn: CheckIn | null;
  streak: CheckInStreak;
  isLoading: boolean;
  saveCheckIn: (input: CaregiverCheckInInput) => Promise<CheckInStreak>;
}

export function useCheckIn(accountId: string | null, timezone?: string): UseCheckInResult {
  const [todayCheckIn, setTodayCheckIn] = useState<CheckIn | null>(null);
  const [streak, setStreak] = useState<CheckInStreak>({
    currentStreak: 0,
    longestStreak: 0,
    lastCompletedDate: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const saveInFlightRef = useRef<Promise<CheckInStreak> | null>(null);
  const knownDatesRef = useRef<string[]>([]);

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
            .select('id, mood, capacity, pressure, support_need, note, created_at, checkin_date')
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

        if (todayResult.error) captureAppError(todayResult.error);
        if (historyResult.error) captureAppError(historyResult.error);

        if (todayResult.data) {
          const remote: CheckIn = {
            id: todayResult.data.id,
            userId: accountId,
            moodScore: todayResult.data.mood as MoodScore,
            capacityScore: isMoodScore(todayResult.data.capacity)
              ? todayResult.data.capacity
              : null,
            pressureScore: isMoodScore(todayResult.data.pressure)
              ? todayResult.data.pressure
              : null,
            supportNeed: parseSupportNeed(todayResult.data.support_need),
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

        const localDates = await getCheckedInDates(accountId);
        if (cancelled) return;
        const remoteDates = historyResult.data?.map((row) => row.checkin_date) ?? [];
        const knownDates = mergeCheckInDates(remoteDates, localDates);
        knownDatesRef.current = knownDates;
        setStreak(computeStreak(knownDates, timezone));
      } else {
        const [existing, dates] = await Promise.all([
          getCheckIn(storageOwner, new Date(), timezone),
          getCheckedInDates(storageOwner),
        ]);
        if (cancelled) return;
        setTodayCheckIn(existing);
        knownDatesRef.current = dates;
        setStreak(computeStreak(dates, timezone));
      }

      if (!cancelled) setIsLoading(false);
    }
    void load().catch(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [accountId, timezone]);

  const saveCheckIn = useCallback((input: CaregiverCheckInInput) => {
    if (saveInFlightRef.current) return saveInFlightRef.current;

    const task = (async () => {
      const now = new Date();
      // React Native/Hermes does not guarantee the browser Web Crypto global.
      // expo-crypto is the native source of UUIDs; a timestamp fallback is not
      // valid for the PostgreSQL uuid column and makes every device save fail.
      const id = createCheckInId(randomUUID);
      const checkinDate = toDateStr(now, timezone);

      const pending: CheckIn = {
        id,
        userId: accountId ?? 'local',
        moodScore: input.moodScore,
        capacityScore: input.capacityScore,
        pressureScore: input.pressureScore,
        supportNeed: input.supportNeed,
        note: input.note?.trim() || null,
        completedAt: now.toISOString(),
        synced: false,
      };

      let completed = pending;
      let updatedStreak: CheckInStreak;

      if (accountId) {
        const remote = await persistDailyCheckIn(
          async () => {
            const { data, error } = await supabase
              .from('checkins')
              .insert({
                id: pending.id,
                account_id: accountId,
                mood: pending.moodScore,
                capacity: pending.capacityScore,
                pressure: pending.pressureScore,
                support_need: pending.supportNeed,
                note: pending.note,
                created_at: pending.completedAt,
                checkin_date: checkinDate,
              })
              .select('id, mood, capacity, pressure, support_need, note, created_at')
              .single();
            return { data, error };
          },
          async () => {
            const { data, error } = await supabase
              .from('checkins')
              .select('id, mood, capacity, pressure, support_need, note, created_at')
              .eq('account_id', accountId)
              .eq('checkin_date', checkinDate)
              .maybeSingle();
            return { data, error };
          },
        );

        completed = {
          id: remote.id,
          userId: accountId,
          moodScore: remote.mood as MoodScore,
          capacityScore: isMoodScore(remote.capacity) ? remote.capacity : null,
          pressureScore: isMoodScore(remote.pressure) ? remote.pressure : null,
          supportNeed: parseSupportNeed(remote.support_need),
          note: remote.note ?? null,
          completedAt: remote.created_at,
          synced: true,
        };
      }

      if (accountId) {
        // The cloud row is authoritative. Device-cache or reminder housekeeping
        // must never turn a successful remote save into a user-visible failure.
        setTodayCheckIn(completed);
        const knownDates = mergeCheckInDates(knownDatesRef.current, [checkinDate]);
        knownDatesRef.current = knownDates;
        updatedStreak = computeStreak(knownDates, timezone);
        setStreak(updatedStreak);
        try {
          await persistLocal(completed, timezone);
        } catch (error) {
          captureAppError(error);
        }
      } else {
        // For anonymous/local use, the device write itself remains authoritative.
        await persistLocal(completed, timezone);
        setTodayCheckIn(completed);
        const localDates = await getCheckedInDates(completed.userId);
        knownDatesRef.current = localDates;
        updatedStreak = computeStreak(localDates, timezone);
        setStreak(updatedStreak);
      }
      void rearmDailyNudge().catch(captureAppError);
      return updatedStreak;
    })().catch((error) => {
      captureAppError(error);
      throw error;
    });

    saveInFlightRef.current = task;
    const clear = () => {
      if (saveInFlightRef.current === task) saveInFlightRef.current = null;
    };
    void task.then(clear, clear);
    return task;
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
