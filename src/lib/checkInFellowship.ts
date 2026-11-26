import type { CaregiverCheckInInput, CheckIn } from '../api/types';
import { isFellowship, type Fellowship } from '../content/fellowshipFinders';
import { checkInFeedback } from './checkInFeedback';

/**
 * After a hard check-in, Today's feedback card suggests a recovery meeting for
 * families (Al-Anon, Nar-Anon, ACA, CoDA, PAL) and, if she says "Not right
 * now", offers Matt reaching out (members) or help booking a session (free
 * accounts). Pure, so tests can import it.
 */

/**
 * "Struggling": overloaded or a low mood, high pressure, or a mood of 2 or
 * less. Never on a safety answer: crisis help comes first and stays alone.
 */
export function isStruggling(checkIn: CaregiverCheckInInput | CheckIn): boolean {
  const { key } = checkInFeedback(checkIn);
  if (key === 'safety') return false;
  return key === 'overloaded' || key === 'lowMood'
    || (checkIn.pressureScore ?? 0) >= 4
    || checkIn.moodScore <= 2;
}

export interface FellowshipStepGate {
  checkIn: CaregiverCheckInInput | CheckIn | null;
  /** Device record loaded (so a step closed earlier today is not shown again). */
  loaded: boolean;
  /** The check-in day this step was closed on, from the device record. */
  closedDay: string | null;
  /** The day of the check-in on screen (YYYY-MM-DD, her time zone). */
  checkInDay: string;
}

/** Shown at most once per check-in day: it belongs to that day's check-in. */
export function showFellowshipStep(gate: FellowshipStepGate): boolean {
  if (!gate.checkIn || !gate.loaded) return false;
  if (gate.closedDay === gate.checkInDay) return false;
  return isStruggling(gate.checkIn);
}

export type FellowshipFollowUp = 'reachOut' | 'booking' | 'wait' | null;

/**
 * What follows "Not right now". A member (Essential or Premier, from the App
 * Store or soberhelpline.com) may ask Matt to reach out; a free direct account
 * is offered help booking a session. An attached account's own team handles
 * it, and an admin is not a member. While her account is not known for
 * certain, nothing is decided yet ('wait'): the right follow-up comes once it
 * is, so a slow start never costs her the day's offer.
 */
export function fellowshipFollowUp(input: {
  settled: boolean;
  isAttached: boolean;
  isAdmin: boolean;
  /** useFeatureAccess('coachMessaging'): a paid membership. */
  isMember: boolean;
}): FellowshipFollowUp {
  if (!input.settled) return 'wait';
  if (input.isAttached || input.isAdmin) return null;
  return input.isMember ? 'reachOut' : 'booking';
}

/** 'waiting': she said "Not right now" before her account was known; nothing is saved yet. */
export type FellowshipStep = 'choose' | 'waiting' | 'reachOut' | 'booking' | 'sending' | 'sent' | 'failed' | 'closed';
export type FellowshipEvent =
  | { type: 'notNow'; followUp: FellowshipFollowUp }
  /** Her account became known while 'waiting'. */
  | { type: 'settled'; followUp: FellowshipFollowUp }
  | { type: 'send' }
  | { type: 'sendResult'; ok: boolean }
  | { type: 'book' }
  | { type: 'decline' };

export function nextFellowshipStep(step: FellowshipStep, event: FellowshipEvent): FellowshipStep {
  switch (event.type) {
    case 'notNow':
      return step === 'choose' ? afterNotNow(event.followUp) : step;
    case 'settled':
      return step === 'waiting' ? afterNotNow(event.followUp) : step;
    case 'send':
      return step === 'reachOut' || step === 'failed' ? 'sending' : step;
    case 'sendResult':
      return step === 'sending' ? (event.ok ? 'sent' : 'failed') : step;
    case 'book':
      return step === 'booking' ? 'closed' : step;
    case 'decline':
      return step === 'reachOut' || step === 'booking' || step === 'failed' ? 'closed' : step;
    default:
      return step;
  }
}

function afterNotNow(followUp: FellowshipFollowUp): FellowshipStep {
  return followUp === 'wait' ? 'waiting' : followUp ?? 'closed';
}

/** Steps that end the day's offer: it is not shown again for this check-in. */
export function fellowshipStepEnded(step: FellowshipStep): boolean {
  return step === 'sent' || step === 'closed';
}

// ── The device record (per account, versioned) ──────────────────────────────
export interface FellowshipRecord {
  fellowship: Fellowship | null;
  closedDay: string | null;
}
export const EMPTY_FELLOWSHIP_RECORD: FellowshipRecord = Object.freeze({ fellowship: null, closedDay: null });
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function fellowshipStorageKey(accountId: string): string {
  return `shl.checkInFellowship.v1:${accountId}`;
}

/** A missing or corrupt value is ignored (read as nothing saved). */
export function parseFellowshipRecord(raw: string | null | undefined): FellowshipRecord {
  if (!raw) return EMPTY_FELLOWSHIP_RECORD;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_FELLOWSHIP_RECORD;
    const { fellowship, closedDay } = value as Record<string, unknown>;
    return {
      fellowship: isFellowship(fellowship) ? fellowship : null,
      closedDay: typeof closedDay === 'string' && DAY.test(closedDay) ? closedDay : null,
    };
  } catch {
    return EMPTY_FELLOWSHIP_RECORD;
  }
}

export function serializeFellowshipRecord(record: FellowshipRecord): string {
  return JSON.stringify({ fellowship: record.fellowship, closedDay: record.closedDay });
}

/** The server's answer to request_reach_out: {ok, already}. */
export function parseReachOutResult(value: unknown): { ok: boolean; already: boolean } {
  if (!value || typeof value !== 'object') return { ok: false, already: false };
  const row = value as Record<string, unknown>;
  return { ok: row.ok === true, already: row.already === true };
}
