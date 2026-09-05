import { useState, useEffect, useCallback, useRef } from 'react';
import type { BoundaryWall } from '../api/types';
import { supabase } from '../lib/supabase';
import { getWalls, saveWall, deleteWall as deleteWallFromStorage } from '../storage/boundaries';
import { boundaryFollowThroughStore } from '../storage/boundaryFollowThrough';

export function useBoundaries(accountId: string | null) {
  const [state, setState] = useState<{ account: string | null; walls: BoundaryWall[]; loading: boolean; error: boolean }>({ account: accountId, walls: [], loading: true, error: false });
  const scope = useRef({ accountId });
  if (scope.current.accountId !== accountId) scope.current = { accountId };
  const renderScope = scope.current;
  const [attempt, setAttempt] = useState(0);
  const mutations = useRef(Promise.resolve());
  useEffect(() => {
    const token = scope.current;
    let active = true;
    setState({ account: accountId, walls: [], loading: true, error: false });
    void (async () => {
      let walls: BoundaryWall[];
      if (accountId) {
        const { data, error } = await supabase.from('walls')
          .select('id, account_id, text, anchor, anchor_tag, shared_with_coach_at, created_at')
          .eq('account_id', accountId).order('created_at', { ascending: true });
        if (error) throw error;
        if (!data) throw new Error('No wall response');
        walls = data.map(row => ({ id: row.id, userId: row.account_id, text: row.text,
          anchorType: row.anchor as BoundaryWall['anchorType'], anchorTag: row.anchor_tag,
          createdAt: row.created_at, sharedWithCoachAt: row.shared_with_coach_at }));
        // Only a successful authoritative list may remove orphaned companion records.
        if (!active || token !== scope.current) return;
        await boundaryFollowThroughStore.prune(accountId, walls.map(w => w.id));
      } else walls = await getWalls();
      if (active && token === scope.current) setState({ account: accountId, walls, loading: false, error: false });
    })().catch(() => {
      if (active && token === scope.current) setState({ account: accountId, walls: [], loading: false, error: true });
    });
    return () => { active = false; };
  }, [accountId, attempt]);
  const ready = state.account === accountId && !state.loading && !state.error;
  function enqueue(task: () => Promise<void>) {
    const next = mutations.current.catch(() => {}).then(task);
    mutations.current = next;
    return next;
  }
  const addWall = useCallback(async (text: string, anchorTag: string | null) => {
    if (!ready || !text.trim()) throw new Error('Boundaries not ready');
    const token = renderScope;
    return enqueue(async () => {
      if (token !== scope.current) throw new Error('Account changed');
      let wall: BoundaryWall;
      if (accountId) {
        const { data, error } = await supabase.from('walls')
          .insert({ account_id: accountId, text: text.trim(), anchor_tag: anchorTag })
          .select('id, account_id, text, anchor, anchor_tag, shared_with_coach_at, created_at').single();
        if (error) throw error;
        if (!data) throw new Error('Boundary was not saved');
        wall = { id: data.id, userId: data.account_id, text: data.text,
          anchorType: data.anchor as BoundaryWall['anchorType'], anchorTag: data.anchor_tag,
          createdAt: data.created_at, sharedWithCoachAt: data.shared_with_coach_at };
      } else {
        wall = { id: `wall-${Date.now()}-${Math.random().toString(36).slice(2)}`, userId: 'local', text: text.trim(),
          anchorType: null, anchorTag, createdAt: new Date().toISOString(), sharedWithCoachAt: null };
        await saveWall(wall);
      }
      if (token === scope.current) setState(prev => ({ ...prev, walls: [...prev.walls, wall] }));
    });
  }, [accountId, ready, renderScope]);
  const removeWall = useCallback(async (id: string) => {
    if (!ready) throw new Error('Boundaries not ready');
    const token = renderScope;
    return enqueue(async () => {
      if (token !== scope.current) throw new Error('Account changed');
      if (accountId) {
        const { error } = await supabase.from('walls').delete().eq('id', id).eq('account_id', accountId);
        if (error) throw error;
        await boundaryFollowThroughStore.remove(accountId, id);
      } else await deleteWallFromStorage(id);
      if (token === scope.current) setState(prev => ({ ...prev, walls: prev.walls.filter(w => w.id !== id) }));
    });
  }, [accountId, ready, renderScope]);
  return { walls: ready ? state.walls : [], loading: state.account !== accountId || state.loading,
    error: state.account === accountId && state.error, reload: () => setAttempt(v => v + 1), addWall, removeWall };
}
