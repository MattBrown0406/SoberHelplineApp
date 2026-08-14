import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultHomecomingWeekPlan,
  HOMECOMING_ITEMS,
  updateHomecomingDischarge,
  updateHomecomingIdentity,
  updateHomecomingItem,
  type HomecomingDischarge,
  type HomecomingIdentity,
  type HomecomingItemId,
  type HomecomingItemState,
  type HomecomingWeekPlan,
} from '../lib/homecomingWeek';
import {
  clearProtectedHomecomingWeek,
  loadProtectedHomecomingWeek,
  saveProtectedHomecomingDischarge,
  saveProtectedHomecomingIdentity,
  saveProtectedHomecomingItem,
} from '../storage/homecomingWeek';

export type HomecomingLoadState = 'loading' | 'ready' | 'error';
export type HomecomingSaveState = 'saved' | 'saving' | 'error';
type Snapshot = { plan: HomecomingWeekPlan; loadState: HomecomingLoadState; saveState: HomecomingSaveState };
type Coordinator = { queue: Promise<void>; version: number; readVersion: number; hadFailure: boolean; clearing: boolean };

const snapshots = new Map<string, Snapshot>();
const listeners = new Map<string, Set<(snapshot: Snapshot) => void>>();
const coordinators = new Map<string, Coordinator>();
const EMPTY: Snapshot = { plan: defaultHomecomingWeekPlan(), loadState: 'loading', saveState: 'saved' };

function coordinatorFor(accountId: string): Coordinator {
  const existing = coordinators.get(accountId);
  if (existing) return existing;
  const next = { queue: Promise.resolve(), version: 0, readVersion: 0, hadFailure: false, clearing: false };
  coordinators.set(accountId, next);
  return next;
}
function publish(accountId: string, patch: Partial<Snapshot>): Snapshot {
  const next = { ...(snapshots.get(accountId) ?? EMPTY), ...patch };
  snapshots.set(accountId, next);
  listeners.get(accountId)?.forEach((listener) => listener(next));
  return next;
}
function subscribe(accountId: string, listener: (snapshot: Snapshot) => void): () => void {
  const group = listeners.get(accountId) ?? new Set();
  group.add(listener);
  listeners.set(accountId, group);
  return () => { group.delete(listener); if (!group.size) listeners.delete(accountId); };
}

export function useHomecomingWeek(accountId: string | null) {
  const [view, setView] = useState<{ accountId: string | null; snapshot: Snapshot }>(() => ({
    accountId,
    snapshot: accountId ? snapshots.get(accountId) ?? EMPTY : { ...EMPTY, loadState: 'ready' },
  }));
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const localGeneration = ++generation.current;
    if (!accountId) {
      setView({ accountId: null, snapshot: { plan: defaultHomecomingWeekPlan(), loadState: 'ready', saveState: 'saved' } });
      return;
    }
    const coordinator = coordinatorFor(accountId);
    if (coordinator.clearing) return;
    const readVersion = ++coordinator.readVersion;
    publish(accountId, { loadState: 'loading' });
    try {
      const loaded = await loadProtectedHomecomingWeek(accountId);
      if (localGeneration !== generation.current || readVersion !== coordinator.readVersion || coordinator.clearing) return;
      publish(accountId, { plan: loaded, loadState: 'ready', saveState: 'saved' });
    } catch {
      if (localGeneration !== generation.current || readVersion !== coordinator.readVersion || coordinator.clearing) return;
      publish(accountId, { loadState: 'error', saveState: 'error' });
    }
  }, [accountId]);

  useEffect(() => {
    if (!accountId) {
      setView({ accountId: null, snapshot: { plan: defaultHomecomingWeekPlan(), loadState: 'ready', saveState: 'saved' } });
      return;
    }
    const apply = (snapshot: Snapshot) => setView({ accountId, snapshot });
    const unsubscribe = subscribe(accountId, apply);
    const existing = snapshots.get(accountId);
    if (existing) apply(existing); else void reload();
    return unsubscribe;
  }, [accountId, reload]);

  const queueWrite = useCallback((work: () => Promise<void>, repairsAll = false) => {
    if (!accountId) return;
    const coordinator = coordinatorFor(accountId);
    if (coordinator.clearing) return;
    const version = ++coordinator.version;
    publish(accountId, { saveState: 'saving' });
    coordinator.queue = coordinator.queue.catch(() => undefined).then(work).then(() => {
      if (repairsAll) coordinator.hadFailure = false;
      if (version === coordinator.version) publish(accountId, { saveState: coordinator.hadFailure ? 'error' : 'saved' });
    }).catch(() => {
      coordinator.hadFailure = true;
      publish(accountId, { saveState: 'error' });
    });
  }, [accountId]);

  const currentReady = useCallback(() => {
    if (!accountId || coordinatorFor(accountId).clearing) return null;
    const current = snapshots.get(accountId);
    return current?.loadState === 'ready' ? current : null;
  }, [accountId]);

  const updateIdentity = useCallback((patch: Partial<HomecomingIdentity>) => {
    const current = currentReady();
    if (!accountId || !current) return;
    const plan = updateHomecomingIdentity(current.plan, patch);
    publish(accountId, { plan });
    queueWrite(() => Promise.all([
      saveProtectedHomecomingIdentity(accountId, plan.identity, plan.updatedAt),
      saveProtectedHomecomingDischarge(accountId, plan.discharge, plan.updatedAt),
    ]).then(() => undefined));
  }, [accountId, currentReady, queueWrite]);

  const updateDischarge = useCallback((patch: Partial<HomecomingDischarge>) => {
    const current = currentReady();
    if (!accountId || !current) return;
    const plan = updateHomecomingDischarge(current.plan, patch);
    publish(accountId, { plan });
    queueWrite(() => saveProtectedHomecomingDischarge(accountId, plan.discharge, plan.updatedAt));
  }, [accountId, currentReady, queueWrite]);

  const updateItem = useCallback((id: HomecomingItemId, patch: Partial<Omit<HomecomingItemState, 'updatedAt'>>) => {
    const current = currentReady();
    if (!accountId || !current) return;
    const plan = updateHomecomingItem(current.plan, id, patch);
    publish(accountId, { plan });
    queueWrite(() => saveProtectedHomecomingItem(accountId, id, plan.items[id], plan.updatedAt));
  }, [accountId, currentReady, queueWrite]);

  const retrySave = useCallback(() => {
    const current = currentReady();
    if (!accountId || !current) return;
    const { plan } = current;
    queueWrite(() => Promise.all([
      saveProtectedHomecomingIdentity(accountId, plan.identity, plan.updatedAt),
      saveProtectedHomecomingDischarge(accountId, plan.discharge, plan.updatedAt),
      ...HOMECOMING_ITEMS.map(({ id }) => saveProtectedHomecomingItem(accountId, id, plan.items[id], plan.updatedAt)),
    ]).then(() => undefined), true);
  }, [accountId, currentReady, queueWrite]);

  const clear = useCallback(async () => {
    if (!accountId) return;
    const coordinator = coordinatorFor(accountId);
    if (coordinator.clearing) return;
    coordinator.clearing = true;
    ++coordinator.readVersion;
    ++coordinator.version;
    publish(accountId, { saveState: 'saving' });
    await coordinator.queue.catch(() => undefined);
    try {
      await clearProtectedHomecomingWeek(accountId);
    } catch (error) {
      coordinator.clearing = false;
      publish(accountId, { saveState: 'error' });
      throw error;
    }
    publish(accountId, { plan: defaultHomecomingWeekPlan(), loadState: 'ready', saveState: 'saved' });
    coordinator.hadFailure = false;
    coordinator.clearing = false;
  }, [accountId]);

  const visible = view.accountId === accountId
    ? view.snapshot
    : accountId ? snapshots.get(accountId) ?? EMPTY : { ...EMPTY, loadState: 'ready' as const };
  return {
    plan: visible.plan,
    hydrated: visible.loadState === 'ready',
    loadState: visible.loadState,
    saveState: visible.saveState,
    updateIdentity,
    updateDischarge,
    updateItem,
    retrySave,
    reload,
    clear,
  };
}
