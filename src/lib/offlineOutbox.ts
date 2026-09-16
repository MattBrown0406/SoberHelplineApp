import AsyncStorage from '@react-native-async-storage/async-storage';
import { isOfflineFallbackError } from './offlineAccountCache';

/**
 * Persisted per-account outbox for writes that failed to reach Supabase.
 *
 * A signed-in member who checks in or posts a family-journal note without a
 * radio should never lose that work or see an error: the item is queued here,
 * shown locally as "saved — will sync", and replayed in original order once
 * connectivity or the app foreground returns. Every item carries a
 * client-generated uuid so a replay that already landed (or an overlapping
 * replay) is deduplicated instead of duplicated.
 */

const OUTBOX_PREFIX = '@sober-helpline/outbox/v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ITEMS = 200;

export interface OutboxStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface CheckInOutboxPayload {
  id: string;
  account_id: string;
  mood: number;
  capacity: number | null;
  pressure: number | null;
  support_need: string | null;
  note: string | null;
  created_at: string;
  checkin_date: string;
}

export interface JournalOutboxPayload {
  id: string;
  family_space_id: string;
  account_id: string;
  note: string;
  created_at: string;
}

export type OutboxItem =
  | { id: string; kind: 'checkin'; queuedAt: string; payload: CheckInOutboxPayload }
  | { id: string; kind: 'journal'; queuedAt: string; payload: JournalOutboxPayload };

export type OutboxKind = OutboxItem['kind'];

interface OutboxEnvelope {
  version: 1;
  accountId: string;
  items: OutboxItem[];
}

export type OutboxHandlerResult = 'synced' | 'retry' | 'drop';

export interface OutboxHandlers {
  checkin: (payload: CheckInOutboxPayload) => Promise<void>;
  journal: (payload: JournalOutboxPayload) => Promise<void>;
}

export interface OutboxReplayResult {
  synced: OutboxItem[];
  dropped: OutboxItem[];
  remaining: OutboxItem[];
}

export function outboxKeyFor(accountId: string): string {
  return `${OUTBOX_PREFIX}:${encodeURIComponent(accountId)}`;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function isScore(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

function isCheckInPayload(value: unknown, accountId: string): value is CheckInOutboxPayload {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return typeof p.id === 'string' && UUID_PATTERN.test(p.id)
    && p.account_id === accountId
    && isScore(p.mood)
    && (p.capacity === null || isScore(p.capacity))
    && (p.pressure === null || isScore(p.pressure))
    && (p.support_need === null || typeof p.support_need === 'string')
    && (p.note === null || typeof p.note === 'string')
    && isIsoTimestamp(p.created_at)
    && typeof p.checkin_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.checkin_date);
}

function isJournalPayload(value: unknown, accountId: string): value is JournalOutboxPayload {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return typeof p.id === 'string' && UUID_PATTERN.test(p.id)
    && typeof p.family_space_id === 'string' && p.family_space_id.length > 0
    && p.account_id === accountId
    && typeof p.note === 'string' && p.note.trim().length > 0 && p.note.length <= 280
    && isIsoTimestamp(p.created_at);
}

export function isOutboxItem(value: unknown, accountId: string): value is OutboxItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !UUID_PATTERN.test(item.id) || !isIsoTimestamp(item.queuedAt)) return false;
  if (item.kind === 'checkin') return isCheckInPayload(item.payload, accountId) && item.payload.id === item.id;
  if (item.kind === 'journal') return isJournalPayload(item.payload, accountId) && item.payload.id === item.id;
  return false;
}

/**
 * Reads the account's outbox. Fails closed: an unreadable envelope, a version
 * or account mismatch, or a malformed item is never replayed. Valid items in a
 * partially damaged envelope are kept; a damaged envelope is treated as empty
 * and reported so the caller can log it.
 */
export function parseOutbox(raw: string | null, accountId: string): { items: OutboxItem[]; corrupted: boolean } {
  if (raw === null) return { items: [], corrupted: false };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { items: [], corrupted: true };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { items: [], corrupted: true };
  const envelope = value as Partial<OutboxEnvelope>;
  if (envelope.version !== 1 || envelope.accountId !== accountId || !Array.isArray(envelope.items)) {
    return { items: [], corrupted: true };
  }
  const seen = new Set<string>();
  const items: OutboxItem[] = [];
  let corrupted = false;
  for (const candidate of envelope.items) {
    if (!isOutboxItem(candidate, accountId)) { corrupted = true; continue; }
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    items.push(candidate);
  }
  return { items, corrupted };
}

/**
 * Classifies a replay failure. Unique violations mean the row already landed
 * (an earlier replay or the original request succeeded after the client gave
 * up), so the item is complete. Data, constraint, and permission errors will
 * never succeed on retry and are dropped rather than blocking the queue.
 * Anything that looks like a lost connection stays queued.
 */
export function classifyOutboxError(error: unknown): OutboxHandlerResult {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  if (code === '23505') return 'synced';
  if (/^(22|23|42)/.test(code) || code === 'PGRST301' || code === '401' || code === '403') return 'drop';
  if (isOfflineFallbackError(error)) return 'retry';
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : NaN;
  if (Number.isFinite(status) && status >= 500) return 'retry';
  if (Number.isFinite(status) && status >= 400) return 'drop';
  // Unknown failures are kept: losing a member's check-in is worse than one
  // more retry on the next foreground.
  return 'retry';
}

export function createOfflineOutbox(storage: OutboxStorage = AsyncStorage) {
  // Serialize every read-modify-write per account so a replay and a new
  // enqueue cannot clobber each other's envelope.
  const chains = new Map<string, Promise<unknown>>();
  function serialized<T>(accountId: string, task: () => Promise<T>): Promise<T> {
    const previous = chains.get(accountId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    chains.set(accountId, next);
    void next.catch(() => undefined).then(() => { if (chains.get(accountId) === next) chains.delete(accountId); });
    return next;
  }

  async function readEnvelope(accountId: string): Promise<{ items: OutboxItem[]; corrupted: boolean }> {
    return parseOutbox(await storage.getItem(outboxKeyFor(accountId)), accountId);
  }

  async function writeItems(accountId: string, items: OutboxItem[]): Promise<void> {
    if (items.length === 0) {
      await storage.removeItem(outboxKeyFor(accountId));
      return;
    }
    const envelope: OutboxEnvelope = { version: 1, accountId, items };
    await storage.setItem(outboxKeyFor(accountId), JSON.stringify(envelope));
  }

  return {
    /** Pending items in replay (enqueue) order. */
    list(accountId: string): Promise<OutboxItem[]> {
      if (!accountId) return Promise.resolve([]);
      return serialized(accountId, async () => (await readEnvelope(accountId)).items);
    },

    /** Queues an item; an id already queued is left untouched. Returns true when newly added. */
    enqueue(accountId: string, item: OutboxItem): Promise<boolean> {
      if (!accountId || !isOutboxItem(item, accountId)) {
        return Promise.reject(new Error('outbox_item_invalid'));
      }
      return serialized(accountId, async () => {
        const { items } = await readEnvelope(accountId);
        if (items.some((existing) => existing.id === item.id)) return false;
        const next = [...items, item];
        // Keep the newest work; a queue this deep means the device has been
        // offline for months and the oldest items are the least useful.
        await writeItems(accountId, next.slice(-MAX_ITEMS));
        return true;
      });
    },

    remove(accountId: string, ids: readonly string[]): Promise<void> {
      if (!accountId || ids.length === 0) return Promise.resolve();
      const drop = new Set(ids);
      return serialized(accountId, async () => {
        const { items } = await readEnvelope(accountId);
        await writeItems(accountId, items.filter((item) => !drop.has(item.id)));
      });
    },

    /** Discards the whole outbox — used on sign-out, where the copy tells the member. */
    clear(accountId: string): Promise<void> {
      if (!accountId) return Promise.resolve();
      return serialized(accountId, () => storage.removeItem(outboxKeyFor(accountId)));
    },

    /**
     * Replays items in order. Stops at the first retryable failure so later
     * items keep their place behind it; permanent failures are dropped and
     * replay continues. Corrupted envelopes are rewritten with only the
     * items that validated.
     */
    replay(accountId: string, handlers: OutboxHandlers): Promise<OutboxReplayResult> {
      if (!accountId) return Promise.resolve({ synced: [], dropped: [], remaining: [] });
      return serialized(accountId, async () => {
        const { items, corrupted } = await readEnvelope(accountId);
        const synced: OutboxItem[] = [];
        const dropped: OutboxItem[] = [];
        let index = 0;
        for (; index < items.length; index++) {
          const item = items[index];
          let outcome: OutboxHandlerResult;
          try {
            if (item.kind === 'checkin') await handlers.checkin(item.payload);
            else await handlers.journal(item.payload);
            outcome = 'synced';
          } catch (error) {
            outcome = classifyOutboxError(error);
          }
          if (outcome === 'retry') break;
          (outcome === 'synced' ? synced : dropped).push(item);
        }
        const remaining = items.slice(index);
        if (synced.length || dropped.length || corrupted) await writeItems(accountId, remaining);
        return { synced, dropped, remaining };
      });
    },
  };
}

export type OfflineOutbox = ReturnType<typeof createOfflineOutbox>;

export const offlineOutbox = createOfflineOutbox();

type OutboxListener = (event: { accountId: string; result: OutboxReplayResult }) => void;
const listeners = new Set<OutboxListener>();

/** Screens subscribe so a replayed check-in or note flips from "will sync" to synced. */
export function subscribeOutboxReplay(listener: OutboxListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function emitOutboxReplay(accountId: string, result: OutboxReplayResult): void {
  if (!result.synced.length && !result.dropped.length) return;
  listeners.forEach((listener) => { try { listener({ accountId, result }); } catch { /* listener errors never break sync */ } });
}
