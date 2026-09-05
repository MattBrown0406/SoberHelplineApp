export type BoundaryResponse = 'yes' | 'not-yet' | 'adjust';
export interface BoundaryFollowThrough {
  communicate: string;
  action: string;
  reviewDate: string;
  response: BoundaryResponse | null;
  reviewedOn: string | null;
}
interface StorageIO {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}
export function localReviewDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function isReviewDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d, 12);
  return y >= 1900 && date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}
function valid(value: unknown): value is BoundaryFollowThrough {
  if (!value || typeof value !== 'object') return false;
  const p = value as BoundaryFollowThrough;
  return typeof p.communicate === 'string' && p.communicate.trim().length > 0 && p.communicate.length <= 2000
    && typeof p.action === 'string' && p.action.trim().length > 0 && p.action.length <= 2000
    && isReviewDate(p.reviewDate)
    && (p.response === null ? p.reviewedOn === null : ['yes', 'not-yet', 'adjust'].includes(p.response) && isReviewDate(p.reviewedOn));
}
export function reviewDue(plan: BoundaryFollowThrough, today = localReviewDate()): boolean {
  return plan.reviewDate <= today && (!plan.reviewedOn || plan.reviewedOn < plan.reviewDate);
}
interface Envelope { version: 1; records: Record<string, BoundaryFollowThrough>; deleted: string[] }
function parse(raw: string | null): Envelope {
  if (raw === null) return { version: 1, records: {}, deleted: [] };
  const data = JSON.parse(raw) as Envelope;
  if (!data || data.version !== 1 || !data.records || typeof data.records !== 'object' || Array.isArray(data.records)
    || !Object.values(data.records).every(valid) || !Array.isArray(data.deleted) || !data.deleted.every(id => typeof id === 'string')) {
    throw new Error('Invalid boundary follow-through storage');
  }
  return data;
}
/** Serialized read-modify-write: no hydration writes or stale account snapshots. */
export function createBoundaryFollowThroughStore(io: StorageIO) {
  const queues = new Map<string, Promise<unknown>>();
  function run<T>(accountId: string, task: (key: string) => Promise<T>): Promise<T> {
    if (!accountId.trim()) return Promise.reject(new Error('Account required'));
    const key = `@sh:boundary-follow-through:v1:${encodeURIComponent(accountId)}`;
    const result = (queues.get(key) ?? Promise.resolve()).catch(() => {}).then(() => task(key));
    queues.set(key, result);
    void result.finally(() => { if (queues.get(key) === result) queues.delete(key); }).catch(() => {});
    return result;
  }
  return {
    get: (account: string, id: string) => run(account, async key => {
      const data = parse(await io.getItem(key));
      return Object.prototype.hasOwnProperty.call(data.records, id) ? data.records[id] : null;
    }),
    save: (account: string, id: string, plan: BoundaryFollowThrough) => {
      // Snapshot caller data before waiting for IO; later UI edits cannot mutate a queued save.
      const snapshot = { ...plan };
      return run(account, async key => {
        if (!id || !valid(snapshot)) throw new Error('Invalid follow-through plan');
        const data = parse(await io.getItem(key));
        if (data.deleted.includes(id)) throw new Error('Boundary removed');
        data.records = { ...data.records, [id]: snapshot };
        await io.setItem(key, JSON.stringify(data));
      });
    },
    remove: (account: string, id: string) => run(account, async key => {
      const data = parse(await io.getItem(key));
      delete data.records[id];
      if (!data.deleted.includes(id)) data.deleted.push(id);
      await io.setItem(key, JSON.stringify(data));
    }),
    prune: (account: string, activeIds: string[]) => run(account, async key => {
      const data = parse(await io.getItem(key));
      const stale = Object.keys(data.records).filter(id => !activeIds.includes(id));
      if (!stale.length) return;
      for (const id of stale) { delete data.records[id]; if (!data.deleted.includes(id)) data.deleted.push(id); }
      await io.setItem(key, JSON.stringify(data));
    }),
  };
}
