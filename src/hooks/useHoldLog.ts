import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type HoldResult = 'held' | 'mostly' | 'slipped';

export interface HoldLogEntry {
  id: string;
  accountId: string;
  weekStart: string;
  result: HoldResult;
  sharedWithFamily: boolean;
  updatedAt: string;
}

function mondayOf(date = new Date()): string {
  const day = date.getUTCDay();
  const diffDays = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + diffDays));
  return monday.toISOString().slice(0, 10);
}

export function currentHoldWeekStart(): string {
  return mondayOf();
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

export function useHoldLog(accountId: string | null, familySpaceId: string | null) {
  const [own, setOwn] = useState<HoldLogEntry | null>(null);
  const [shared, setShared] = useState<HoldLogEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const weekStart = currentHoldWeekStart();

  const load = useCallback(async () => {
    if (!accountId) {
      setOwn(null);
      setShared([]);
      return;
    }

    const { data: mine } = await supabase
      .from('wall_hold_logs')
      .select('id, account_id, week_start, result, shared_with_family, updated_at')
      .eq('account_id', accountId)
      .eq('week_start', weekStart)
      .maybeSingle();

    setOwn(mine ? mapRow(mine) : null);

    if (!familySpaceId) {
      setShared([]);
      return;
    }

    const { data: family } = await supabase
      .from('wall_hold_logs')
      .select('id, account_id, week_start, result, shared_with_family, updated_at')
      .eq('family_space_id', familySpaceId)
      .eq('week_start', weekStart)
      .eq('shared_with_family', true)
      .order('updated_at', { ascending: false });

    setShared((family ?? []).filter((row) => row.account_id !== accountId).map(mapRow));
  }, [accountId, familySpaceId, weekStart]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (result: HoldResult, shareWithFamily: boolean) => {
      if (!accountId) return;
      setSaving(true);
      try {
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
      } finally {
        setSaving(false);
      }
    },
    [accountId, familySpaceId, weekStart, load],
  );

  return { own, shared, weekStart, saving, save, reload: load };
}
