import { emptyGuidedStart, parseGuidedStart, type GuidedStart } from '../lib/guidedStart';
interface StorageIO { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }
interface Snapshot { value: GuidedStart; ready: boolean; busy: boolean; error: 'load' | 'save' | null }
/** Shared authoritative snapshots + serialized IO prevent sibling-screen lost updates.
 * Hydration never writes. Only explicit edits/reset write, and publish after durable success. */
export function createGuidedStartStore(io: StorageIO) {
  const entries = new Map<string, { snapshot: Snapshot; listeners: Set<() => void>; queue: Promise<unknown> }>();
  const entry = (id: string) => {
    if (!id) throw Error('An account is required');
    let e = entries.get(id);
    if (!e) { e = { snapshot: { value: emptyGuidedStart(), ready: false, busy: false, error: null }, listeners: new Set(), queue: Promise.resolve() }; entries.set(id, e); }
    return e;
  };
  const key = (id: string) => `@sh:guided-start:v1:${encodeURIComponent(id)}`;
  const publish = (id: string, patch: Partial<Snapshot>) => { const e = entry(id); e.snapshot = { ...e.snapshot, ...patch }; e.listeners.forEach(fn => fn()); };
  const enqueue = (id: string, action: () => Promise<void>) => {
    const e = entry(id); const task = e.queue.then(action, action); e.queue = task.catch(() => undefined); return task;
  };
  return {
    snapshot: (id: string) => entry(id).snapshot,
    subscribe: (id: string, fn: () => void) => { const e = entry(id); e.listeners.add(fn); return () => { e.listeners.delete(fn); }; },
    load: (id: string) => enqueue(id, async () => {
      publish(id, { busy: true, error: null });
      try { publish(id, { value: parseGuidedStart(await io.getItem(key(id))), ready: true }); }
      catch { publish(id, { ready: false, error: 'load' }); }
      finally { publish(id, { busy: false }); }
    }),
    edit: (id: string, update: (current: GuidedStart) => GuidedStart) => enqueue(id, async () => {
      if (!entry(id).snapshot.ready) throw Error('Load or reset before editing');
      publish(id, { busy: true, error: null });
      try {
        // Never expose the published snapshot to a caller's mutating updater:
        // a failed write must leave the last durable value untouched.
        const current = parseGuidedStart(JSON.stringify(entry(id).snapshot.value));
        const value = parseGuidedStart(JSON.stringify(update(current)));
        await io.setItem(key(id), JSON.stringify(value)); publish(id, { value });
      } catch (error) { publish(id, { error: 'save' }); throw error; }
      finally { publish(id, { busy: false }); }
    }),
    reset: (id: string) => enqueue(id, async () => {
      publish(id, { busy: true, error: null });
      try { const value = emptyGuidedStart(); await io.setItem(key(id), JSON.stringify(value)); publish(id, { value, ready: true }); }
      catch (error) { publish(id, { error: 'save' }); throw error; }
      finally { publish(id, { busy: false }); }
    }),
  };
}
