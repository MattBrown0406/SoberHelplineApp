export type Language = 'en' | 'es';
export type Practice = { version: 1; revision: string | null; step: number; choices: (number | null)[]; wording: string[]; completed: boolean };
export const freshPractice = (): Practice => ({ version: 1, revision: null, step: 0, choices: [null, null, null], wording: ['', '', ''], completed: false });
export class StalePracticeError extends Error {
  constructor() { super('Practice changed or was reset. Reload before editing.'); this.name = 'StalePracticeError'; }
}
// An opaque revision also acts as the reset generation; no private data is retained.
let sequence = 0;
function nextRevision(): string { return `${Date.now().toString(36)}-${++sequence}-${Math.random().toString(36).slice(2)}`; }
export function validate(value: unknown): Practice {
  const p = value as Practice;
  if (!p || p.version !== 1 || !Number.isInteger(p.step) || p.step < 0 || p.step > 3 ||
    !Array.isArray(p.choices) || p.choices.length !== 3 || !p.choices.every(c => c === null || c === 0 || c === 1) ||
    !Array.isArray(p.wording) || p.wording.length !== 3 || !p.wording.every(w => typeof w === 'string' && w.length <= 1000) ||
    typeof p.completed !== 'boolean' || ((p.completed || p.step === 3) && p.choices.some(c => c === null)) ||
    p.choices.slice(0, p.step).some(c => c === null)) throw new Error('Invalid saved practice');
  if (p.revision !== undefined && p.revision !== null && (typeof p.revision !== 'string' || !p.revision.length || p.revision.length > 200)) throw new Error('Invalid saved practice revision');
  // Upgrade legacy v1 records without discarding their answers.
  return { ...p, revision: p.revision ?? null };
}
export function advance(p: Practice): Practice {
  validate(p);
  if (p.step >= 3 || p.choices[p.step] === null) throw new Error('Choose a response first');
  return validate({ ...p, step: p.step + 1, completed: p.completed || p.step === 2 });
}
export function back(p: Practice): Practice { return validate({ ...p, step: Math.max(0, p.step - 1) }); }
export interface Storage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void> }
export function storageKey(userId: string) { if (!userId.trim()) throw new Error('Account required'); return `sh:free-practice:v1:${encodeURIComponent(userId)}`; }
// All operations for an account are serialized, including reset and reads.
const queues = new Map<string, Promise<unknown>>();
function queued<T>(key: string, task: () => Promise<T>): Promise<T> {
  const result = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(task);
  queues.set(key, result);
  void result.finally(() => { if (queues.get(key) === result) queues.delete(key); }).catch(() => undefined);
  return result;
}
async function readPractice(storage: Storage, key: string): Promise<Practice> {
  const raw = await storage.getItem(key);
  return raw === null ? freshPractice() : validate(JSON.parse(raw));
}
export function loadPractice(storage: Storage, id: string): Promise<Practice> {
  const key = storageKey(id);
  return queued(key, () => readPractice(storage, key));
}
// Serialized compare/write fences sibling screens, including saves queued after
// reset. Durable revisions fence old snapshots after reload and in other tabs.
// Storage has no CAS/transaction: simultaneous writes in separate JS runtimes
// remain best-effort; read-back detects conflicts but is not a cross-tab lock.
export function savePractice(storage: Storage, id: string, p: Practice): Promise<Practice> {
  const key = storageKey(id);
  const snapshot: Practice = JSON.parse(JSON.stringify(validate(p)));
  return queued(key, async () => {
    const current = await readPractice(storage, key);
    if (snapshot.revision !== current.revision) throw new StalePracticeError();
    const saved = { ...snapshot, revision: nextRevision() };
    await storage.setItem(key, JSON.stringify(saved));
    const confirmed = await readPractice(storage, key);
    if (confirmed.revision !== saved.revision) throw new StalePracticeError();
    return confirmed;
  });
}
export function resetPractice(storage: Storage, id: string): Promise<Practice> {
  const key = storageKey(id);
  return queued(key, async () => {
    // Keep a bounded empty tombstone, not removeItem: deletion would make old
    // null-revision snapshots valid again. Reset also repairs corrupt records.
    const reset = { ...freshPractice(), revision: nextRevision() };
    await storage.setItem(key, JSON.stringify(reset));
    const confirmed = await readPractice(storage, key);
    if (confirmed.revision !== reset.revision) throw new StalePracticeError();
    return confirmed;
  });
}
