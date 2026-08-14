import { useCallback, useEffect, useState } from 'react';
import {
  defaultFamilyVisitationPlan,
  updateFamilyVisitationPlan,
  type FamilyVisitationPlan,
} from '../lib/familyVisitationPlan';
import {
  clearProtectedFamilyVisitationPlan,
  loadProtectedFamilyVisitationPlan,
  saveProtectedFamilyVisitationPlan,
} from '../storage/familyVisitationPlan';

type LoadState = 'loading' | 'ready' | 'error';
type SaveState = 'saved' | 'saving' | 'error';
type Snapshot = { plan: FamilyVisitationPlan; loadState: LoadState; saveState: SaveState };
type Coordinator = {
  snapshot: Snapshot;
  listeners: Set<(snapshot: Snapshot) => void>;
  queue: Promise<void>;
  generation: number;
  readVersion: number;
  hydrating: boolean;
  clearing: boolean;
};

const coordinators = new Map<string, Coordinator>();

function coordinatorFor(accountId: string): Coordinator {
  const existing = coordinators.get(accountId);
  if (existing) return existing;
  const created: Coordinator = {
    snapshot: { plan: defaultFamilyVisitationPlan(), loadState: 'loading', saveState: 'saved' },
    listeners: new Set(),
    queue: Promise.resolve(),
    generation: 0,
    readVersion: 0,
    hydrating: false,
    clearing: false,
  };
  coordinators.set(accountId, created);
  return created;
}

function publish(coordinator: Coordinator, snapshot: Snapshot): void {
  coordinator.snapshot = snapshot;
  coordinator.listeners.forEach((listener) => listener(snapshot));
}

async function hydrate(accountId: string, coordinator: Coordinator): Promise<void> {
  if (coordinator.hydrating || coordinator.snapshot.loadState === 'ready' || coordinator.clearing) return;
  coordinator.hydrating = true;
  const readVersion = coordinator.readVersion;
  publish(coordinator, { ...coordinator.snapshot, loadState: 'loading' });
  try {
    const plan = await loadProtectedFamilyVisitationPlan(accountId);
    if (readVersion !== coordinator.readVersion || coordinator.clearing) return;
    publish(coordinator, { plan, loadState: 'ready', saveState: 'saved' });
  } catch {
    if (readVersion !== coordinator.readVersion || coordinator.clearing) return;
    publish(coordinator, { ...coordinator.snapshot, loadState: 'error', saveState: 'error' });
  } finally {
    coordinator.hydrating = false;
  }
}

export function useFamilyVisitationPlan(accountId: string | null) {
  const [snapshot, setSnapshot] = useState<Snapshot>(() => accountId
    ? coordinatorFor(accountId).snapshot
    : { plan: defaultFamilyVisitationPlan(), loadState: 'ready', saveState: 'saved' });

  useEffect(() => {
    if (!accountId) {
      setSnapshot({ plan: defaultFamilyVisitationPlan(), loadState: 'ready', saveState: 'saved' });
      return undefined;
    }
    const coordinator = coordinatorFor(accountId);
    const listener = (next: Snapshot) => setSnapshot(next);
    coordinator.listeners.add(listener);
    setSnapshot(coordinator.snapshot);
    void hydrate(accountId, coordinator);
    return () => { coordinator.listeners.delete(listener); };
  }, [accountId]);

  const update = useCallback((patch: Partial<Omit<FamilyVisitationPlan, 'updatedAt'>>) => {
    if (!accountId) return;
    const coordinator = coordinatorFor(accountId);
    if (coordinator.clearing || coordinator.snapshot.loadState !== 'ready') return;
    const plan = updateFamilyVisitationPlan(coordinator.snapshot.plan, patch);
    const generation = ++coordinator.generation;
    publish(coordinator, { plan, loadState: 'ready', saveState: 'saving' });
    coordinator.queue = coordinator.queue
      .catch(() => undefined)
      .then(async () => {
        if (coordinator.clearing) return;
        await saveProtectedFamilyVisitationPlan(accountId, plan);
        if (generation === coordinator.generation && !coordinator.clearing) {
          publish(coordinator, { plan, loadState: 'ready', saveState: 'saved' });
        }
      })
      .catch(() => {
        if (generation === coordinator.generation && !coordinator.clearing) {
          publish(coordinator, { plan, loadState: 'ready', saveState: 'error' });
        }
      });
  }, [accountId]);

  const reload = useCallback(async () => {
    if (!accountId) return;
    const coordinator = coordinatorFor(accountId);
    if (coordinator.clearing) return;
    coordinator.snapshot = { ...coordinator.snapshot, loadState: 'loading' };
    await hydrate(accountId, coordinator);
  }, [accountId]);

  const retrySave = useCallback(() => {
    if (!accountId) return;
    update(coordinatorFor(accountId).snapshot.plan);
  }, [accountId, update]);

  const clear = useCallback(async () => {
    if (!accountId) return;
    const coordinator = coordinatorFor(accountId);
    if (coordinator.clearing) return;
    coordinator.clearing = true;
    ++coordinator.readVersion;
    ++coordinator.generation;
    try {
      await coordinator.queue.catch(() => undefined);
      await clearProtectedFamilyVisitationPlan(accountId);
      publish(coordinator, { plan: defaultFamilyVisitationPlan(), loadState: 'ready', saveState: 'saved' });
    } catch {
      publish(coordinator, { ...coordinator.snapshot, loadState: 'error', saveState: 'error' });
      throw new Error('protected_visitation_clear_failed');
    } finally {
      coordinator.clearing = false;
    }
  }, [accountId]);

  return { ...snapshot, update, reload, retrySave, clear };
}
