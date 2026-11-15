import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import {
  comingFamilySquaresMeetingDate,
  isCancelledMeetingDate,
  isFamilySquaresKnownCancelled,
  loadFamilySquaresCancelledDate,
} from '../lib/familySquaresCancelled';

/**
 * What a screen other than Today needs to know before it says "join Family
 * Squares tonight": whether the website cancelled the coming meeting, and
 * whether she answered "can't make it" for it. The same two sources Today's
 * call card reads (the cancelled check, and her answer in session_rsvps).
 *
 * Both are kept as the meeting DATE they were read for and compared with the
 * coming meeting's date on every draw, so last week's answer never speaks for
 * this week. Fail open: a read that fails is "not cancelled, not declined".
 * Nothing is read while `enabled` is false (any day but meeting day).
 */
export function useMondayMeetingWeek(accountId: string | null, enabled: boolean): { cancelled: boolean; declined: boolean } {
  const [week, setWeek] = useState<{ accountId: string; cancelledDate: string | null; declinedDate: string | null } | null>(null);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const request = ++generation.current;
    if (!accountId || !enabled) {
      setWeek(null);
      return;
    }
    const [cancelledDate, declinedDate] = await Promise.all([loadFamilySquaresCancelledDate(), loadDeclinedDate(accountId)]);
    if (request !== generation.current) return;
    setWeek({ accountId, cancelledDate, declinedDate });
  }, [accountId, enabled]);

  useEffect(() => () => { ++generation.current; }, []);
  // Tabs stay mounted: read again each time this one is opened, and when the
  // app comes back to the front with it already in view.
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => {
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') void load(); });
    return () => appState.remove();
  }, [load]);

  const mine = enabled && week !== null && week.accountId === accountId ? week : null;
  return {
    // (Before this screen's own read lands, what another screen was just told counts.)
    cancelled: enabled && !!accountId && (mine ? isCancelledMeetingDate(mine.cancelledDate) : isFamilySquaresKnownCancelled()),
    declined: mine !== null && mine.declinedDate !== null && mine.declinedDate === comingFamilySquaresMeetingDate(),
  };
}

/** The coming meeting's date when she said "can't make it" for it, else null. Never throws. */
async function loadDeclinedDate(accountId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('session_rsvps')
      .select('family_squares_meeting_date')
      .eq('account_id', accountId)
      .eq('status', 'declined');
    if (error || !Array.isArray(data)) return null;
    const coming = comingFamilySquaresMeetingDate();
    return data.some((row) => (row as { family_squares_meeting_date?: unknown }).family_squares_meeting_date === coming) ? coming : null;
  } catch {
    return null;
  }
}
