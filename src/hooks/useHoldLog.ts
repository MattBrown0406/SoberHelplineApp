import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import { subscribeFamilySpaceRefresh } from '../lib/familySpaceRefresh';
import { isNewBoundaryWin } from '../lib/reviewPromptPolicy';
import { getWeekStart } from '../lib/trackerWeek';

export type HoldResult = 'held' | 'mostly' | 'slipped';

export interface HoldLogEntry {
  id: string;
  accountId: string;
  weekStart: string;
  result: HoldResult;
  sharedWithFamily: boolean;
  updatedAt: string;
}

/** The member's own week: a Sunday-evening entry belongs to the week ending. */
export function currentHoldWeekStart(timezone?: string): string {
  return getWeekStart(new Date(), timezone);
}

function mapRow(row: {
  id: string;
  account_id: string;
  week_start: string;
  result: string;
  shared_with_family: boolean;
  updated_at: string;
}): HoldLogEntry {
  return {
    id: row.id,
    accountId: row.account_id,
    weekStart: row.week_start,
    result: row.result as HoldResult,
    sharedWithFamily: row.shared_with_family,
    updatedAt: row.updated_at,
  };
}

export function useHoldLog(accountId: string | null, familySpaceId: string | null, timezone?: string) {
  const [own, setOwn] = useState<HoldLogEntry | null>(null);
  const [shared, setShared] = useState<HoldLogEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const saveInFlightRef = useRef(false);
  const accountIdRef = useRef(accountId);
  accountIdRef.current = accountId;
  const weekStart = currentHoldWeekStart(timezone);

  const loadGeneration = useRef(0);

  // Re-read on mount, screen focus (the screens call reload), foreground and
  // family-space changes. A failed read keeps what is on screen.
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    if (!accountId) {
      setOwn(null);
      setShared([]);
      return;
    }

    const { data: mine, error: mineError } = await supabase
      .from('wall_hold_logs')
      .select('id, account_id, week_start, result, shared_with_family, updated_at')
      .eq('account_id', accountId)
      .eq('week_start', weekStart)
      .maybeSingle();
    if (generation !== loadGeneration.current) return;
    if (!mineError) setOwn(mine ? mapRow(mine) : null);

    if (!familySpaceId) {
      setShared([]);
      return;
    }

    const { data: family, error: familyError } = await supabase
      .from('wall_hold_logs')
      .select('id, account_id, week_start, result, shared_with_family, updated_at')
      .eq('family_space_id', familySpaceId)
      .eq('week_start', weekStart)
      .eq('shared_with_family', true)
      .order('updated_at', { ascending: false });
    if (generation !== loadGeneration.current || familyError) return;

    setShared((family ?? []).filter((row) => row.account_id !== accountId).map(mapRow));
  }, [accountId, familySpaceId, weekStart]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  useEffect(() => {
    if (!accountId) return;
    const reread = () => { void load().catch(() => undefined); };
    const unsubscribe = subscribeFamilySpaceRefresh(reread);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') reread();
    });
    return () => {
      unsubscribe();
      appState.remove();
    };
  }, [accountId, load]);

  const save = useCallback(
    async (result: HoldResult, shareWithFamily: boolean) => {
      if (!accountId || saveInFlightRef.current) return false;
      saveInFlightRef.current = true;
      setSaving(true);
      try {
        const { data: previous, error: previousError } = await supabase
          .from('wall_hold_logs')
          .select('result')
          .eq('account_id', accountId)
          .eq('week_start', weekStart)
          .maybeSingle();
        if (previousError) throw previousError;
        const newlyHeld = isNewBoundaryWin(
          (previous?.result as HoldResult | undefined) ?? null,
          result,
        );
        const { error } = await supabase.from('wall_hold_logs').upsert(
          {
            account_id: accountId,
            family_space_id: familySpaceId,
            week_start: weekStart,
            result,
            shared_with_family: shareWithFamily && !!familySpaceId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'account_id,week_start' },
        );
        if (error) throw error;
        await load();
        return accountIdRef.current === accountId && newlyHeld;
      } finally {
        saveInFlightRef.current = false;
        setSaving(false);
      }
    },
    [accountId, familySpaceId, weekStart, load],
  );

  return { own, shared, weekStart, saving, save, reload: load };
}
