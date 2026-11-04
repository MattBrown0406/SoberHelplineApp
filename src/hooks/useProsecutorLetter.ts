import { useCallback, useEffect, useState } from 'react';
import {
  defaultProsecutorLetter,
  updateProsecutorLetter,
  type ProsecutorLetter,
} from '../lib/prosecutorLetter';
import {
  clearProtectedProsecutorLetter,
  loadProtectedProsecutorLetter,
  saveProtectedProsecutorLetter,
} from '../storage/prosecutorLetter';

type LoadState = 'loading' | 'ready' | 'error';
type SaveState = 'saved' | 'saving' | 'error';
type Snapshot = { plan: ProsecutorLetter; loadState: LoadState; saveState: SaveState };
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
    snapshot: { plan: defaultProsecutorLetter(), loadState: 'loading', saveState: 'saved' },
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
    const plan = await loadProtectedProsecutorLetter(accountId);
    if (readVersion !== coordinator.readVersion || coordinator.clearing) return;
    publish(coordinator, { plan, loadState: 'ready', saveState: 'saved' });
  } catch {
    if (readVersion !== coordinator.readVersion || coordinator.clearing) return;
    publish(coordinator, { ...coordinator.snapshot, loadState: 'error', saveState: 'error' });
  } finally {
    coordinator.hydrating = false;
  }
}

export function useProsecutorLetter(accountId: string | null) {
  const emptySnapshot: Snapshot = { plan: defaultProsecutorLetter(), loadState: 'ready', saveState: 'saved' };
  const [bound, setBound] = useState<{ accountId: string | null; snapshot: Snapshot }>(() => ({
    accountId,
    snapshot: accountId ? coordinatorFor(accountId).snapshot : emptySnapshot,
  }));

  useEffect(() => {
    if (!accountId) {
      setBound({ accountId: null, snapshot: emptySnapshot });
      return undefined;
    }
    const coordinator = coordinatorFor(accountId);
    const listener = (next: Snapshot) => setBound({ accountId, snapshot: next });
    coordinator.listeners.add(listener);
    setBound({ accountId, snapshot: coordinator.snapshot });
    void hydrate(accountId, coordinator);
    return () => { coordinator.listeners.delete(listener); };
  }, [accountId]);

  const update = useCallback((patch: Partial<Omit<ProsecutorLetter, 'updatedAt'>>) => {
    if (!accountId) return;
    const coordinator = coordinatorFor(accountId);
    if (coordinator.clearing || coordinator.snapshot.loadState !== 'ready') return;
    // Kept from the Visitation Plan pattern: never throw from a tap.
    let plan: ProsecutorLetter;
    try {
      plan = updateProsecutorLetter(coordinator.snapshot.plan, patch);
    } catch {
      return;
    }
    const generation = ++coordinator.generation;
    publish(coordinator, { plan, loadState: 'ready', saveState: 'saving' });
    coordinator.queue = coordinator.queue
      .catch(() => undefined)
      .then(async () => {
        if (coordinator.clearing) return;
        await saveProtectedProsecutorLetter(accountId, plan);
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
      await clearProtectedProsecutorLetter(accountId);
      publish(coordinator, { plan: defaultProsecutorLetter(), loadState: 'ready', saveState: 'saved' });
    } catch {
      publish(coordinator, { ...coordinator.snapshot, loadState: 'error', saveState: 'error' });
      throw new Error('protected_prosecutor_clear_failed');
    } finally {
      coordinator.clearing = false;
    }
  }, [accountId]);

  const visibleSnapshot = bound.accountId === accountId
    ? bound.snapshot
    : accountId ? coordinatorFor(accountId).snapshot : emptySnapshot;
  return { ...visibleSnapshot, update, reload, retrySave, clear };
}
