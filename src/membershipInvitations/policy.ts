export const DAY = 24 * 60 * 60 * 1000;
export type Placement = 'practice-completed' | 'boundary-saved' | 'after-meeting' | 'tool-finished' | 'checkin-week';
export const PLACEMENTS: readonly Placement[] = ['practice-completed', 'boundary-saved', 'after-meeting', 'tool-finished', 'checkin-week'];

/** At most one invitation in this long, whichever placement it is. */
export const MIN_GAP = 7 * DAY;
/** At most MAX_IN_WINDOW invitations in any WINDOW. */
export const WINDOW = 30 * DAY;
export const MAX_IN_WINDOW = 3;
/** None in her first days: the account must be at least this old. */
export const NEW_ACCOUNT_QUIET = 3 * DAY;
/** The after-Family-Squares invitation shows at most once in this long, on top of every other limit. */
export const AFTER_MEETING_GAP = 14 * DAY;
/** "Not now": 7 days the first time, 14 the second, 30 from then on. */
export const NOT_NOW_SNOOZES: readonly number[] = [7 * DAY, 14 * DAY, 30 * DAY];
/** This many shown in a row that she neither tapped nor dismissed: a pause of UNANSWERED_PAUSE. */
export const UNANSWERED_LIMIT = 3;
export const UNANSWERED_PAUSE = 30 * DAY;

export interface Storage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }

// Version 1 (4.3): afterMeetingAt was added later and is optional.
interface RecordV1 { version: 1; optedOut: boolean; snoozedUntil: number; lastShownAt: number | null; afterMeetingAt?: number | null }
// Version 2 (4.4). Only her answers and times: never anything about the activity.
interface RecordV2 {
  version: 2;
  optedOut: boolean;
  snoozedUntil: number;
  /** How many times she has said "Not now" (sets the next snooze). */
  notNowCount: number;
  /** When each invitation was shown, within the last WINDOW (newest last). */
  shownAt: number[];
  afterMeetingAt: number | null;
  /** Shown in a row with no tap and no dismissal. */
  unanswered: number;
}
const empty = (): RecordV2 => ({ version: 2, optedOut: false, snoozedUntil: 0, notNowCount: 0, shownAt: [], afterMeetingAt: null, unanswered: 0 });
export const invitationKey = (id: string) => `membership-invitation:v2:${encodeURIComponent(id)}`;
/** Where 4.3 kept the record. Read (never written) until the first version-2 write. */
export const legacyInvitationKey = (id: string) => `membership-invitation:v1:${encodeURIComponent(id)}`;

const time = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const count = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1000;

function parseV1(r: RecordV1): RecordV2 {
  if (typeof r.optedOut !== 'boolean' || !time(r.snoozedUntil) ||
    !(r.lastShownAt === null || time(r.lastShownAt)) ||
    !(r.afterMeetingAt === undefined || r.afterMeetingAt === null || time(r.afterMeetingAt))) throw new Error('invalid invitation preferences');
  return {
    version: 2,
    optedOut: r.optedOut,
    snoozedUntil: r.snoozedUntil,
    // A version-1 snooze was a "Not now" (or the permanent opt-out, which wins anyway).
    notNowCount: r.snoozedUntil > 0 && !r.optedOut ? 1 : 0,
    shownAt: r.lastShownAt === null ? [] : [r.lastShownAt],
    afterMeetingAt: r.afterMeetingAt ?? null,
    unanswered: 0,
  };
}
function parse(raw: string): RecordV2 {
  const r = JSON.parse(raw);
  if (!r || typeof r !== 'object') throw new Error('invalid invitation preferences');
  if (r.version === 1) return parseV1(r);
  if (r.version !== 2 || typeof r.optedOut !== 'boolean' || !time(r.snoozedUntil) || !count(r.notNowCount) ||
    !Array.isArray(r.shownAt) || r.shownAt.length > 50 || !r.shownAt.every(time) ||
    !(r.afterMeetingAt === null || time(r.afterMeetingAt)) || !count(r.unanswered)) throw new Error('invalid invitation preferences');
  return r;
}
async function read(storage: Storage, id: string): Promise<RecordV2> {
  const raw = await storage.getItem(invitationKey(id));
  if (raw !== null) return parse(raw);
  const legacy = await storage.getItem(legacyInvitationKey(id));
  return legacy === null ? empty() : parse(legacy);
}
const write = (storage: Storage, id: string, record: RecordV2) => storage.setItem(invitationKey(id), JSON.stringify(record));

export interface ClaimContext {
  /** When her account was created (ms), or null when not known: then she counts as new. */
  joinedAt: number | null;
}

/**
 * One shared instance per app runtime. No activity/response contents are accepted.
 * `askedThisVisit(id)` is true when another ask (the App Store rating prompt or
 * the reminder ask) has had this visit: then nothing is claimed (visitAsks.ts).
 */
export function createInvitationPolicy(storage: Storage, now = Date.now, askedThisVisit: (id: string) => boolean = () => false) {
  let queue: Promise<unknown> = Promise.resolve();
  const failed = new Set<string>();
  const visible = new Set<string>();
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work, work); queue = next.catch(() => {}); return next;
  }
  // Her answer to a card (a tap on "See plans", "Not now" or "Don't show again").
  function answer(id: string, current: () => boolean, change: (record: RecordV2, time: number) => RecordV2): Promise<boolean> {
    // The card is gone either way: its claim is released even if the answer cannot be kept.
    if (id) visible.delete(id);
    return serial(async () => {
      if (!id || !current()) return false;
      visible.delete(id);
      try {
        const record = await read(storage, id);
        if (!current()) return false;
        await write(storage, id, change({ ...record, unanswered: 0 }, now()));
        return true;
      } catch { failed.add(id); return false; }
    });
  }
  return {
    claim(id: string, placement: Placement, current: () => boolean, context: ClaimContext): Promise<boolean> {
      return serial(async () => {
        if (!id || !current() || failed.has(id) || visible.has(id) ||
          !PLACEMENTS.includes(placement) || askedThisVisit(id)) return false;
        try {
          const record = await read(storage, id);
          const t = now();
          if (!current() || askedThisVisit(id) || !Number.isFinite(t) || record.optedOut || t < record.snoozedUntil) return false;
          // Her first days: nothing. An unknown start counts as new.
          const joinedAt = context?.joinedAt;
          if (typeof joinedAt !== 'number' || !Number.isFinite(joinedAt) || t - joinedAt < NEW_ACCOUNT_QUIET) return false;
          // A clock that moved backwards keeps every later time: they still count.
          const shownAt = record.shownAt.filter(at => t - at < WINDOW);
          const last = record.shownAt.length ? Math.max(...record.shownAt) : null;
          if (last !== null && t - last < MIN_GAP) return false;
          if (shownAt.length >= MAX_IN_WINDOW) return false;
          let unanswered = record.unanswered;
          if (unanswered >= UNANSWERED_LIMIT) {
            if (last !== null && t - last < UNANSWERED_PAUSE) return false;
            unanswered = 0;
          }
          const afterMeeting = placement === 'after-meeting';
          if (afterMeeting && record.afterMeetingAt !== null && t - record.afterMeetingAt < AFTER_MEETING_GAP) return false;
          await write(storage, id, { ...record, shownAt: [...shownAt, t], unanswered: unanswered + 1,
            ...(afterMeeting ? { afterMeetingAt: t } : {}) });
          if (!current()) return false;
          visible.add(id);
          return true;
        } catch { failed.add(id); return false; }
      });
    },
    /** "See plans": she answered, so the run of unanswered cards starts again. */
    tapped(id: string, current: () => boolean): Promise<boolean> {
      return answer(id, current, record => record);
    },
    dismiss(id: string, permanently: boolean, current: () => boolean): Promise<boolean> {
      return answer(id, current, (record, t) => {
        if (permanently) return { ...record, optedOut: true };
        const snooze = NOT_NOW_SNOOZES[Math.min(record.notNowCount, NOT_NOW_SNOOZES.length - 1)];
        return { ...record, notNowCount: record.notNowCount + 1, snoozedUntil: Math.max(record.snoozedUntil, t + snooze) };
      });
    },
    release(id: string) { visible.delete(id); },
  };
}
