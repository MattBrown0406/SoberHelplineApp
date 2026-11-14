import { familySquaresSyncWindow } from '../../supabase/functions/_shared/family-squares-time';
import { isFamilySquaresSession } from './familySquaresSchedule';
import type { PushDestination } from './pushRouting';

/**
 * When a tap means "I am walking into the meeting": from 30 minutes before
 * Family Squares starts (Mondays, 7:00 PM Pacific) until its hour is over.
 * Reminder pushes that say "tap to join" open Zoom only inside this window,
 * and only a Join tap inside it can count as attending.
 */
export const JOIN_LEAD_MS = 30 * 60_000;

/** The meeting that is about to start or under way, or null at any other time. */
export function familySquaresJoinWindow(now: Date = new Date()): { meetingDate: string; start: Date } | null {
  // The next meeting that has not ended: tonight's until its hour is over.
  const { meetingDate, start } = familySquaresSyncWindow(now);
  return start.getTime() - now.getTime() <= JOIN_LEAD_MS ? { meetingDate, start } : null;
}

/**
 * The session a "tap to join" reminder is about, or null for any other push.
 *
 * A session reminder that is not asking for a question routes to Support with
 * the session it is about (pushRouting). When that session turns out to be
 * Family Squares, the tap opens Zoom itself (meeting about to start or under
 * way) or lands on Today's call card. Every other session reminder
 * (La Sobremesa keeps its personal link on Support) and the "send a question"
 * reminder open what they always opened.
 */
export function reminderJoinSessionId(destination: PushDestination | null): string | null {
  if (destination?.pathname !== '/(tabs)/support' || !('params' in destination) || !destination.params) return null;
  return destination.params.ask ? null : destination.params.sessionId;
}

export type ReminderTapPlan =
  /** Not a Family Squares reminder: the push opens what it always opened. */
  | { action: 'default' }
  /** Family Squares, but not meeting time or no link yet: Today's call card. */
  | { action: 'call_card' }
  /** Family Squares is about to start or under way: open the meeting itself. */
  | { action: 'open_meeting'; url: string; meetingDate: string };

/**
 * What tapping a "tap to join" reminder does, given the session the push
 * names. Only the Family Squares session ever opens Zoom from a push; a
 * missing or odd link lands on the call card instead of failing.
 */
export function familySquaresReminderTapPlan(
  session: { title?: string | null; zoom_url?: string | null } | null | undefined,
  now: Date = new Date(),
): ReminderTapPlan {
  if (!isFamilySquaresSession(session)) return { action: 'default' };
  const window = familySquaresJoinWindow(now);
  const url = typeof session?.zoom_url === 'string' ? session.zoom_url.trim() : '';
  if (!window || !/^https:\/\/\S+$/i.test(url)) return { action: 'call_card' };
  return { action: 'open_meeting', url, meetingDate: window.meetingDate };
}

/**
 * What the device already knows about the session a reminder names, before
 * any network: it remembers which session row is Family Squares
 * (familySquaresSessionCache).
 * - 'other'          — a different session (La Sobremesa, a group): the tap
 *                      opens what it always opened, at once, with no lookup.
 * - 'family_squares' — look the link up, briefly; if that is slow or fails,
 *                      Today's call card (which has the Join button).
 * - 'unknown'        — this device has not seen the session list yet: look
 *                      up, briefly; if that is slow or fails, the usual destination.
 */
export type ReminderSessionKnowledge = 'family_squares' | 'other' | 'unknown';

export function reminderSessionKnowledge(sessionId: string, knownFamilySquaresId: string | null | undefined): ReminderSessionKnowledge {
  if (!knownFamilySquaresId) return 'unknown';
  return knownFamilySquaresId.toLowerCase() === sessionId.toLowerCase() ? 'family_squares' : 'other';
}

/** Where the tap goes when the lookup is slow or fails. */
export function reminderLookupFallback(knowledge: ReminderSessionKnowledge): ReminderTapPlan {
  return knowledge === 'family_squares' ? { action: 'call_card' } : { action: 'default' };
}

// ── Real attendance ─────────────────────────────────────────────────────────
// A Join tap only says she opened Zoom, and the Join button works from 30
// minutes before the start. She attended when she is back in the app after the
// meeting has been going for ten minutes AND ten minutes or more after her tap.

export type JoinSource = 'today' | 'support' | 'push';
const JOIN_SOURCES: readonly JoinSource[] = ['today', 'support', 'push'];

/** Kept on the device from the Join tap until attendance is logged or the evening is over. */
export type JoinMark = { schemaVersion: 1; joinedAt: string; meetingDate: string; source: JoinSource };

export const ATTENDED_MINIMUM_MS = 10 * 60_000;
/** Family Squares runs for an hour (family-squares-time). */
export const MEETING_LENGTH_MS = 60 * 60_000;
/** A return this long after the meeting's end still counts; after it the mark is stale. */
export const RETURN_GRACE_MS = 2 * 60 * 60_000;

/**
 * When the meeting a mark belongs to starts, or null for a mark that was not
 * made inside that meeting's join window (never trusted).
 */
export function joinMarkMeetingStartMs(mark: JoinMark): number | null {
  const joinedAt = new Date(mark.joinedAt);
  const { meetingDate, start } = familySquaresSyncWindow(joinedAt);
  const startMs = start.getTime();
  if (meetingDate !== mark.meetingDate || startMs - joinedAt.getTime() > JOIN_LEAD_MS) return null;
  return startMs;
}

/** A mark for a Join tap made at meeting time; null at any other time of the week. */
export function newJoinMark(source: JoinSource, now: Date = new Date()): JoinMark | null {
  const window = familySquaresJoinWindow(now);
  return window
    ? { schemaVersion: 1, joinedAt: now.toISOString(), meetingDate: window.meetingDate, source }
    : null;
}

export function parseJoinMark(raw: string | null | undefined): JoinMark | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const mark = value as Partial<JoinMark>;
    if (mark.schemaVersion !== 1
      || typeof mark.joinedAt !== 'string' || !Number.isFinite(Date.parse(mark.joinedAt))
      || typeof mark.meetingDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(mark.meetingDate)
      || !JOIN_SOURCES.includes(mark.source as JoinSource)) return null;
    return mark as JoinMark;
  } catch {
    return null;
  }
}

/**
 * What to do with a Join mark when the app is in front again:
 * - 'keep'    — too early to say (the meeting has not been going ten minutes,
 *               or she tapped less than ten minutes ago): look again on her
 *               next return, so a quick look at the app mid-meeting never
 *               throws her attendance away.
 * - 'discard' — this meeting is already logged, or the evening is over
 *               (the meeting's end plus the grace period), or the clock is off.
 * - 'log'     — record `attended_10min`, once per meeting date.
 */
export function attendanceDecision(
  mark: JoinMark,
  nowMs: number,
  lastLoggedMeetingDate: string | null,
): 'keep' | 'discard' | 'log' {
  if (lastLoggedMeetingDate === mark.meetingDate) return 'discard';
  const joinedMs = Date.parse(mark.joinedAt);
  const startMs = joinMarkMeetingStartMs(mark);
  // A mark that is not from a join window, or a clock that moved backwards.
  if (startMs === null || nowMs < joinedMs) return 'discard';
  if (nowMs > startMs + MEETING_LENGTH_MS + RETURN_GRACE_MS) return 'discard';
  // Never before the meeting has started: an early tap waits for start + 10.
  const countsFromMs = Math.max(joinedMs, startMs) + ATTENDED_MINIMUM_MS;
  return nowMs >= countsFromMs ? 'log' : 'keep';
}
