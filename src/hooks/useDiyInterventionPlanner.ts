import { useCallback, useEffect, useState } from 'react';
import { defaultDiyInterventionPlan, type DiyInterventionPlan } from '../lib/diyInterventionPlanner';
import {
  clearProtectedDiyInterventionPlan,
  loadProtectedDiyInterventionPlan,
  saveProtectedDiyInterventionPlan,
} from '../storage/diyInterventionPlanner';

export type DiyLoadState = 'loading' | 'ready' | 'error';
export type DiySaveState = 'saved' | 'saving' | 'error';
type Snapshot = { plan: DiyInterventionPlan; loadState: DiyLoadState; saveState: DiySaveState };
type Coordinator = {
  snapshot: Snapshot;
  listeners: Set<(snapshot: Snapshot) => void>;
  queue: Promise<void>;
  version: number;
  readVersion: number;
  lastSettledLoadState: Exclude<DiyLoadState, 'loading'> | null;
  clearing: boolean;
  hadFailure: boolean;
};
const coordinators = new Map<string, Coordinator>();
const EMPTY: Snapshot = { plan: defaultDiyInterventionPlan(), loadState: 'loading', saveState: 'saved' };

function coordinatorFor(accountId: string): Coordinator {
  const existing = coordinators.get(accountId);
  if (existing) return existing;
  const coordinator: Coordinator = {
    snapshot: { ...EMPTY, plan: defaultDiyInterventionPlan() }, listeners: new Set(), queue: Promise.resolve(),
    version: 0, readVersion: 0, lastSettledLoadState: null, clearing: false, hadFailure: false,
  };
  coordinators.set(accountId, coordinator);
  return coordinator;
}
function publish(coordinator: Coordinator, patch: Partial<Snapshot>) {
  coordinator.snapshot = { ...coordinator.snapshot, ...patch };
  coordinator.listeners.forEach((listener) => listener(coordinator.snapshot));
}
async function hydrate(accountId: string, coordinator: Coordinator) {
  if (coordinator.clearing) return;
  if (coordinator.hadFailure) {
    publish(coordinator, { saveState: 'error' });
    return;
  }
  const recoveryLoadState = coordinator.lastSettledLoadState ?? 'error';
  const readVersion = ++coordinator.readVersion;
  const mutationVersion = coordinator.version;
  publish(coordinator, { loadState: 'loading' });
  try {
    await coordinator.queue.catch(() => undefined);
    if (readVersion !== coordinator.readVersion || mutationVersion !== coordinator.version || coordinator.clearing) return;
    if (coordinator.hadFailure) {
      publish(coordinator, {
        loadState: recoveryLoadState,
        saveState: 'error',
      });
      return;
    }
    const plan = await loadProtectedDiyInterventionPlan(accountId);
    if (readVersion !== coordinator.readVersion || mutationVersion !== coordinator.version || coordinator.clearing) return;
    if (coordinator.hadFailure) {
      publish(coordinator, {
        loadState: recoveryLoadState,
        saveState: 'error',
      });
      return;
    }
    coordinator.lastSettledLoadState = 'ready';
    publish(coordinator, { plan, loadState: 'ready', saveState: 'saved' });
  } catch {
    if (readVersion !== coordinator.readVersion || coordinator.clearing) return;
    coordinator.lastSettledLoadState = 'error';
    publish(coordinator, { loadState: 'error', saveState: 'error' });
  }
}

export function useDiyInterventionPlanner(accountId: string | null) {
  const signedOut: Snapshot = { plan: defaultDiyInterventionPlan(), loadState: 'ready', saveState: 'saved' };
  const [bound, setBound] = useState<{ accountId: string | null; snapshot: Snapshot }>(() => ({
    accountId, snapshot: accountId ? coordinatorFor(accountId).snapshot : signedOut,
  }));

  useEffect(() => {
    if (!accountId) { setBound({ accountId: null, snapshot: signedOut }); return undefined; }
    const coordinator = coordinatorFor(accountId);
    const listener = (snapshot: Snapshot) => setBound({ accountId, snapshot });
    coordinator.listeners.add(listener);
    setBound({ accountId, snapshot: coordinator.snapshot });
    if (coordinator.snapshot.loadState !== 'ready') void hydrate(accountId, coordinator);
    return () => { coordinator.listeners.delete(listener); };
  }, [accountId]);

  const update = useCallback((transform: (plan: DiyInterventionPlan) => DiyInterventionPlan) => {
    if (!accountId) return;
    const coordinator = coordinatorFor(accountId);
    if (coordinator.clearing || coordinator.snapshot.loadState !== 'ready') return;
    const plan = transform(coordinator.snapshot.plan);
    ++coordinator.readVersion;
    const version = ++coordinator.version;
    publish(coordinator, { plan, saveState: 'saving' });
    coordinator.queue = coordinator.queue.catch(() => undefined).then(async () => {
      if (coordinator.clearing) throw new Error('protected_diy_clear_in_progress');
      await saveProtectedDiyInterventionPlan(accountId, plan);
    }).then(() => {
      if (version === coordinator.version && !coordinator.clearing) {
        coordinator.hadFailure = false;
        publish(coordinator, { saveState: 'saved' });
      }
    }).catch(() => {
      coordinator.hadFailure = true;
      if (!coordinator.clearing) publish(coordinator, { saveState: 'error' });
    });
  }, [accountId]);

  const retrySave = useCallback(() => {
    if (!accountId) return;
    const coordinator = coordinatorFor(accountId);
    if (coordinator.clearing || coordinator.snapshot.loadState !== 'ready') return;
    const plan = coordinator.snapshot.plan;
    ++coordinator.readVersion;
    const version = ++coordinator.version;
    publish(coordinator, { saveState: 'saving' });
    coordinator.queue = coordinator.queue.catch(() => undefined)
      .then(() => saveProtectedDiyInterventionPlan(accountId, plan))
      .then(() => {
        if (version === coordinator.version && !coordinator.clearing) {
          coordinator.hadFailure = false;
          publish(coordinator, { saveState: 'saved' });
        }
      })
      .catch(() => {
        coordinator.hadFailure = true;
        if (!coordinator.clearing) publish(coordinator, { saveState: 'error' });
      });
  }, [accountId]);

  const reload = useCallback(() => {
    if (!accountId) return Promise.resolve();
    return hydrate(accountId, coordinatorFor(accountId));
  }, [accountId]);

  const clear = useCallback(async () => {
    if (!accountId) return;
    const coordinator = coordinatorFor(accountId);
    if (coordinator.clearing) return;
    coordinator.clearing = true;
    ++coordinator.readVersion;
    ++coordinator.version;
    publish(coordinator, { saveState: 'saving' });
    await coordinator.queue.catch(() => undefined);
    try {
      await clearProtectedDiyInterventionPlan(accountId);
      coordinator.hadFailure = false;
      coordinator.lastSettledLoadState = 'ready';
      publish(coordinator, { plan: defaultDiyInterventionPlan(), loadState: 'ready', saveState: 'saved' });
    } catch (error) {
      coordinator.hadFailure = true;
      coordinator.lastSettledLoadState = 'error';
      publish(coordinator, { loadState: 'error', saveState: 'error' });
      throw error;
    } finally {
      coordinator.clearing = false;
    }
  }, [accountId]);

  const visible = bound.accountId === accountId ? bound.snapshot : accountId ? coordinatorFor(accountId).snapshot : signedOut;
  return { ...visible, update, retrySave, reload, clear };
}
