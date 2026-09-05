export const DAY = 24 * 60 * 60 * 1000;
export type Placement = 'practice-completed' | 'boundary-saved';
export interface Storage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }
interface RecordV1 { version: 1; optedOut: boolean; snoozedUntil: number; lastShownAt: number | null }
const empty = (): RecordV1 => ({ version: 1, optedOut: false, snoozedUntil: 0, lastShownAt: null });
export const invitationKey = (id: string) => `membership-invitation:v1:${encodeURIComponent(id)}`;
function parse(raw: string | null): RecordV1 {
  if (raw === null) return empty();
  const r = JSON.parse(raw);
  if (!r || r.version !== 1 || typeof r.optedOut !== 'boolean' ||
    !Number.isFinite(r.snoozedUntil) || r.snoozedUntil < 0 ||
    !(r.lastShownAt === null || (Number.isFinite(r.lastShownAt) && r.lastShownAt >= 0))) throw new Error('invalid invitation preferences');
  return r;
}
/** One shared instance per app runtime. No activity/response contents are accepted. */
export function createInvitationPolicy(storage: Storage, now = Date.now) {
  let queue: Promise<unknown> = Promise.resolve();
  const failed = new Set<string>();
  const visible = new Set<string>();
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work, work); queue = next.catch(() => {}); return next;
  }
  return {
    claim(id: string, placement: Placement, current: () => boolean): Promise<boolean> {
      return serial(async () => {
        if (!id || !current() || failed.has(id) || visible.has(id) ||
          !['practice-completed', 'boundary-saved'].includes(placement)) return false;
        try {
          const record = parse(await storage.getItem(invitationKey(id)));
          const time = now();
          if (!current() || !Number.isFinite(time) || record.optedOut || time < record.snoozedUntil ||
            (record.lastShownAt !== null && time - record.lastShownAt < DAY)) return false;
          await storage.setItem(invitationKey(id), JSON.stringify({ ...record, lastShownAt: time }));
          if (!current()) return false;
          visible.add(id);
          return true;
        } catch { failed.add(id); return false; }
      });
    },
    dismiss(id: string, permanently: boolean, current: () => boolean): Promise<boolean> {
      return serial(async () => {
        if (!id || !current()) return false;
        visible.delete(id);
        try {
          const record = parse(await storage.getItem(invitationKey(id)));
          if (!current()) return false;
          await storage.setItem(invitationKey(id), JSON.stringify({ ...record,
            optedOut: record.optedOut || permanently, snoozedUntil: Math.max(record.snoozedUntil, now() + 7 * DAY) }));
          return true;
        } catch { failed.add(id); return false; }
      });
    },
    release(id: string) { visible.delete(id); },
  };
}
