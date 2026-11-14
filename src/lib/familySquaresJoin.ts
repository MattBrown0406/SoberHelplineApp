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

// ── Real attendance ─────────────────────────────────────────────────────────
// A Join tap only says she opened Zoom. Coming back to the app ten minutes or
// more later says she stayed (the same signal the rating prompt already uses).

export type JoinSource = 'today' | 'support' | 'push';
const JOIN_SOURCES: readonly JoinSource[] = ['today', 'support', 'push'];

/** Kept on the device from the Join tap until she is back in the app. */
export type JoinMark = { schemaVersion: 1; joinedAt: string; meetingDate: string; source: JoinSource };

export const ATTENDED_MINIMUM_MS = 10 * 60_000;
export const ATTENDED_MAXIMUM_MS = 3 * 60 * 60_000;
/** The app can flicker to "active" while Zoom is opening; that is not a return. */
export const JOIN_SETTLE_MS = 5_000;

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
 * - 'keep'    — Zoom is still opening (a few seconds in); look again next time.
 * - 'discard' — back within ten minutes, a stale mark, or this meeting is already logged.
 * - 'log'     — she stayed ten minutes or more: record `attended_10min` once.
 */
export function attendanceDecision(
  mark: JoinMark,
  nowMs: number,
  lastLoggedMeetingDate: string | null,
): 'keep' | 'discard' | 'log' {
  const elapsed = nowMs - Date.parse(mark.joinedAt);
  if (elapsed >= 0 && elapsed < JOIN_SETTLE_MS) return 'keep';
  if (elapsed < ATTENDED_MINIMUM_MS || elapsed > ATTENDED_MAXIMUM_MS) return 'discard';
  return lastLoggedMeetingDate === mark.meetingDate ? 'discard' : 'log';
}
