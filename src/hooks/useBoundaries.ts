import { useState, useEffect, useCallback } from 'react';
import type { BoundaryWall } from '../api/types';
import { supabase } from '../lib/supabase';
import {
  getWalls,
  saveWall,
  deleteWall as deleteWallFromStorage,
} from '../storage/boundaries';

export function useBoundaries(accountId: string | null) {
  const [walls, setWalls] = useState<BoundaryWall[]>([]);

  useEffect(() => {
    if (accountId) {
      supabase
        .from('walls')
        .select('id, account_id, text, anchor, anchor_tag, shared_with_coach_at, created_at')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true })
        .then(({ data }) => {
          if (data) {
            setWalls(
              data.map((row) => ({
                id: row.id,
                userId: row.account_id,
                text: row.text,
                anchorType: row.anchor as BoundaryWall['anchorType'],
                anchorTag: row.anchor_tag,
                createdAt: row.created_at,
                sharedWithCoachAt: row.shared_with_coach_at,
              })),
            );
          }
        });
    } else {
      getWalls().then(setWalls);
    }
  }, [accountId]);

  const addWall = useCallback(
    async (text: string, anchorTag: string | null) => {
      if (accountId) {
        const { data, error } = await supabase
          .from('walls')
          .insert({ account_id: accountId, text: text.trim(), anchor_tag: anchorTag })
          .select('id, account_id, text, anchor, anchor_tag, shared_with_coach_at, created_at')
          .single();
        if (data && !error) {
          setWalls((prev) => [
            ...prev,
            {
              id: data.id,
              userId: data.account_id,
              text: data.text,
              anchorType: data.anchor as BoundaryWall['anchorType'],
              anchorTag: data.anchor_tag,
              createdAt: data.created_at,
              sharedWithCoachAt: data.shared_with_coach_at,
            },
          ]);
        }
      } else {
        const wall: BoundaryWall = {
          id: `wall-${Date.now()}`,
          userId: 'local',
          text: text.trim(),
          anchorType: null,
          anchorTag,
          createdAt: new Date().toISOString(),
          sharedWithCoachAt: null,
        };
        await saveWall(wall);
        setWalls((prev) => [...prev, wall]);
      }
    },
    [accountId],
  );

  const removeWall = useCallback(
    async (id: string) => {
      setWalls((prev) => prev.filter((w) => w.id !== id));
      if (accountId) {
        await supabase.from('walls').delete().eq('id', id).eq('account_id', accountId);
      } else {
        await deleteWallFromStorage(id);
      }
    },
    [accountId],
  );

  return { walls, addWall, removeWall };
}
