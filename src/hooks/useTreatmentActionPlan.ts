import { useCallback, useEffect, useRef, useState } from 'react';
import {
  defaultTreatmentActionPlan,
  TREATMENT_ACTION_ITEMS,
  updateTreatmentActionExecution,
  updateTreatmentActionItem,
  type TreatmentActionExecution,
  type TreatmentActionItemId,
  type TreatmentActionPlan,
  type TreatmentActionStatus,
} from '../lib/treatmentActionPlan';
import {
  clearProtectedTreatmentActionPlan,
  loadProtectedTreatmentActionPlan,
  saveProtectedTreatmentActionExecution,
  saveProtectedTreatmentActionItem,
} from '../storage/treatmentActionPlan';

export type TreatmentActionLoadState = 'loading' | 'ready' | 'error';
type SaveState = 'saved' | 'saving' | 'error';
type Snapshot = {
  plan: TreatmentActionPlan;
  loadState: TreatmentActionLoadState;
  saveState: SaveState;
};
type WriteCoordinator = {
  queue: Promise<void>;
  version: number;
  hadFailure: boolean;
};

const sharedSnapshots = new Map<string, Snapshot>();
const listeners = new Map<string, Set<(snapshot: Snapshot) => void>>();
const writeCoordinators = new Map<string, WriteCoordinator>();

function coordinatorFor(accountId: string): WriteCoordinator {
  const existing = writeCoordinators.get(accountId);
  if (existing) return existing;
  const coordinator = { queue: Promise.resolve(), version: 0, hadFailure: false };
  writeCoordinators.set(accountId, coordinator);
  return coordinator;
}

function publish(accountId: string, patch: Partial<Snapshot>): Snapshot {
  const current = sharedSnapshots.get(accountId) ?? {
    plan: defaultTreatmentActionPlan(),
    loadState: 'loading' as const,
    saveState: 'saved' as const,
  };
  const next = { ...current, ...patch };
  sharedSnapshots.set(accountId, next);
  listeners.get(accountId)?.forEach((listener) => listener(next));
  return next;
}

function subscribe(accountId: string, listener: (snapshot: Snapshot) => void): () => void {
  const accountListeners = listeners.get(accountId) ?? new Set();
  accountListeners.add(listener);
  listeners.set(accountId, accountListeners);
  return () => {
    accountListeners.delete(listener);
    if (!accountListeners.size) listeners.delete(accountId);
  };
}

const EMPTY_SNAPSHOT: Snapshot = {
  plan: defaultTreatmentActionPlan(),
  loadState: 'loading',
  saveState: 'saved',
};

export function useTreatmentActionPlan(accountId: string | null) {
  const [view, setView] = useState<{ accountId: string | null; snapshot: Snapshot }>(() => ({
    accountId,
    snapshot: accountId
      ? sharedSnapshots.get(accountId) ?? EMPTY_SNAPSHOT
      : { ...EMPTY_SNAPSHOT, loadState: 'ready' },
  }));
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const currentGeneration = ++generation.current;
    if (!accountId) {
      setView({
        accountId: null,
        snapshot: { plan: defaultTreatmentActionPlan(), loadState: 'ready', saveState: 'saved' },
      });
      return;
    }
    publish(accountId, { loadState: 'loading' });
    try {
      const loaded = await loadProtectedTreatmentActionPlan(accountId);
      if (currentGeneration !== generation.current) return;
      publish(accountId, { plan: loaded, loadState: 'ready', saveState: 'saved' });
    } catch {
      if (currentGeneration !== generation.current) return;
      // Never convert a read failure into a writable blank plan. The caller
      // must retry or explicitly clear protected storage before editing.
      publish(accountId, { loadState: 'error', saveState: 'error' });
    }
  }, [accountId]);

  useEffect(() => {
    if (!accountId) {
      setView({
        accountId: null,
        snapshot: { plan: defaultTreatmentActionPlan(), loadState: 'ready', saveState: 'saved' },
      });
      return;
    }
    const apply = (next: Snapshot) => setView({ accountId, snapshot: next });
    const unsubscribe = subscribe(accountId, apply);
    const existing = sharedSnapshots.get(accountId);
    if (existing) apply(existing);
    else void reload();
    return unsubscribe;
  }, [accountId, reload]);

  const queueWrite = useCallback((work: () => Promise<void>, repairsAllItems = false) => {
    if (!accountId) return;
    const coordinator = coordinatorFor(accountId);
    const version = ++coordinator.version;
    publish(accountId, { saveState: 'saving' });
    coordinator.queue = coordinator.queue
      .catch(() => undefined)
      .then(work)
      .then(() => {
        if (repairsAllItems) coordinator.hadFailure = false;
        if (version === coordinator.version) {
          publish(accountId, { saveState: coordinator.hadFailure ? 'error' : 'saved' });
        }
      })
      .catch(() => {
        coordinator.hadFailure = true;
        publish(accountId, { saveState: 'error' });
      });
  }, [accountId]);

  const updateItem = useCallback((
    id: TreatmentActionItemId,
    patch: Partial<{ status: TreatmentActionStatus; details: string }>,
  ) => {
    if (!accountId) return;
    const current = sharedSnapshots.get(accountId);
    if (!current || current.loadState !== 'ready') return;
    const nextPlan = updateTreatmentActionItem(current.plan, id, patch);
    publish(accountId, { plan: nextPlan });
    queueWrite(() => saveProtectedTreatmentActionItem(
      accountId,
      id,
      nextPlan.items[id],
      nextPlan.updatedAt,
    ));
  }, [accountId, queueWrite]);

  const updateExecution = useCallback((patch: Partial<TreatmentActionExecution>) => {
    if (!accountId) return;
    const current = sharedSnapshots.get(accountId);
    if (!current || current.loadState !== 'ready') return;
    const nextPlan = updateTreatmentActionExecution(current.plan, patch);
    publish(accountId, { plan: nextPlan });
    queueWrite(() => saveProtectedTreatmentActionExecution(
      accountId,
      nextPlan.execution,
      nextPlan.updatedAt,
    ));
  }, [accountId, queueWrite]);

  const retrySave = useCallback(() => {
    if (!accountId) return;
    const current = sharedSnapshots.get(accountId);
    if (!current || current.loadState !== 'ready') return;
    queueWrite(() => Promise.all([
      ...TREATMENT_ACTION_ITEMS.map((definition) =>
        saveProtectedTreatmentActionItem(
          accountId,
          definition.id,
          current.plan.items[definition.id],
          current.plan.updatedAt,
        )),
      saveProtectedTreatmentActionExecution(
        accountId,
        current.plan.execution,
        current.plan.updatedAt,
      ),
    ]).then(() => undefined), true);
  }, [accountId, queueWrite]);

  const clear = useCallback(async () => {
    if (!accountId) return;
    const coordinator = coordinatorFor(accountId);
    ++coordinator.version;
    publish(accountId, { saveState: 'saving' });
    await coordinator.queue.catch(() => undefined);
    try {
      await clearProtectedTreatmentActionPlan(accountId);
    } catch (error) {
      publish(accountId, { saveState: 'error' });
      throw error;
    }
    publish(accountId, {
      plan: defaultTreatmentActionPlan(),
      loadState: 'ready',
      saveState: 'saved',
    });
    coordinator.hadFailure = false;
  }, [accountId]);

  const visibleSnapshot = view.accountId === accountId
    ? view.snapshot
    : accountId
      ? sharedSnapshots.get(accountId) ?? EMPTY_SNAPSHOT
      : { ...EMPTY_SNAPSHOT, loadState: 'ready' as const };

  return {
    plan: visibleSnapshot.plan,
    hydrated: visibleSnapshot.loadState === 'ready',
    loadState: visibleSnapshot.loadState,
    saveState: visibleSnapshot.saveState,
    updateItem,
    updateExecution,
    retrySave,
    reload,
    clear,
  };
}
