/**
 * When to ask for notification permission. Onboarding asks once, on its
 * seventh screen, and most people skip it, so the app cannot remind them about
 * Monday. These rules pick the better moments:
 * - right after she saves a seat at Family Squares (the ask sits under it);
 * - a gentle second chance on Today, at most once every 14 days.
 * The system dialog shows only once on iOS, so nothing here ever opens it:
 * these only decide whether to show the in-app ask, and only her tap on
 * "Remind me" opens the dialog. Pure, so tests pin the rules.
 */
export const REMINDER_ASK_QUIET_DAYS = 14;

const DAY_MS = 86_400_000;

/**
 * What the device says about notifications:
 * - 'granted'  — reminders can reach her; nothing to ask.
 * - 'askable'  — the system dialog can still be shown.
 * - 'blocked'  — she said no to the system dialog; only device Settings can change it.
 */
export type ReminderPermission = 'granted' | 'askable' | 'blocked';

/** Reads expo-notifications' permission answer. Null (unreadable) means: do not ask. */
export function reminderPermissionFrom(
  response: { status?: string | null; granted?: boolean; canAskAgain?: boolean } | null | undefined,
): ReminderPermission | null {
  if (!response) return null;
  if (response.granted === true || response.status === 'granted') return 'granted';
  if (response.canAskAgain === false) return 'blocked';
  // An older answer without canAskAgain: "denied" is final, anything else can be asked.
  if (response.canAskAgain === undefined && response.status === 'denied') return 'blocked';
  return 'askable';
}

/** What this device remembers about asking, per account. */
export interface ReminderAskMemory {
  schemaVersion: 1;
  /** She finished onboarding (which asks once) on this device. */
  onboardedAt: string | null;
  /** "Not now" on the ask under a saved seat. */
  seatDismissedAt: string | null;
  /** The last day Today's second chance was put on screen. */
  todayShownAt: string | null;
  /** "Not now" on Today's second chance. */
  todayDismissedAt: string | null;
}

export function emptyReminderAskMemory(): ReminderAskMemory {
  return { schemaVersion: 1, onboardedAt: null, seatDismissedAt: null, todayShownAt: null, todayDismissedAt: null };
}

export function reminderAskStorageKey(accountId: string): string {
  return `@sh:reminder-ask:${accountId}`;
}

function time(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

/** An unreadable record is treated as empty: asking once more is cheap. */
export function parseReminderAskMemory(raw: string | null | undefined): ReminderAskMemory {
  if (!raw) return emptyReminderAskMemory();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyReminderAskMemory();
    const memory = value as Partial<ReminderAskMemory>;
    if (memory.schemaVersion !== 1) return emptyReminderAskMemory();
    return {
      schemaVersion: 1,
      onboardedAt: time(memory.onboardedAt),
      seatDismissedAt: time(memory.seatDismissedAt),
      todayShownAt: time(memory.todayShownAt),
      todayDismissedAt: time(memory.todayDismissedAt),
    };
  } catch {
    return emptyReminderAskMemory();
  }
}

/** 'ask' shows "Remind me" / "Not now"; 'settings' shows the one line with "Open Settings". */
export type ReminderAskKind = 'ask' | 'settings';

function kindFor(permission: ReminderPermission | null): ReminderAskKind | null {
  return permission === 'askable' ? 'ask' : permission === 'blocked' ? 'settings' : null;
}

function withinQuietDays(at: string | null, now: Date): boolean {
  if (!at) return false;
  const elapsed = now.getTime() - Date.parse(at);
  // A clock set back reads as "just asked": never ask sooner on a guess.
  return elapsed < REMINDER_ASK_QUIET_DAYS * DAY_MS;
}

function sameLocalDay(at: string | null | undefined, now: Date): boolean {
  const then = at ? new Date(at) : null;
  if (!then || !Number.isFinite(then.getTime())) return false;
  return then.getFullYear() === now.getFullYear() && then.getMonth() === now.getMonth() && then.getDate() === now.getDate();
}

/**
 * The ask under a seat she has just saved: this is when a reminder is worth
 * the most to her. Shown unless reminders already work, or she said "Not now"
 * to this same ask in the last 14 days.
 */
export function seatReminderAsk(input: {
  /** False on the web, where the app sends no reminders. */
  supported: boolean;
  /** Her seat went from not saved to saved while the panel was on screen. */
  justSaved: boolean;
  permission: ReminderPermission | null;
  memory: ReminderAskMemory;
  now: Date;
}): ReminderAskKind | null {
  if (!input.supported || !input.justSaved) return null;
  if (withinQuietDays(input.memory.seatDismissedAt, input.now)) return null;
  return kindFor(input.permission);
}

/**
 * Today's second chance, for someone who has been using the app without
 * reminders. At most one showing every 14 days (it stays for the day it first
 * appears, so it does not vanish mid-visit), never on the day she onboarded,
 * never beside the seat ask or the welcome-back card, and not for 14 days
 * after any "Not now".
 */
export function todayReminderAsk(input: {
  supported: boolean;
  permission: ReminderPermission | null;
  memory: ReminderAskMemory;
  /** When the account was created: stands in for onboarding on a device that did not record it. */
  joinedAt: string | null | undefined;
  now: Date;
  seatAskShowing: boolean;
  welcomeBackShowing: boolean;
}): ReminderAskKind | null {
  const { memory, now } = input;
  if (!input.supported || input.seatAskShowing || input.welcomeBackShowing) return null;
  if (sameLocalDay(memory.onboardedAt, now) || sameLocalDay(input.joinedAt, now)) return null;
  if (withinQuietDays(memory.todayDismissedAt, now) || withinQuietDays(memory.seatDismissedAt, now)) return null;
  // Already shown in this 14-day stretch: only the day it first appeared still counts.
  if (withinQuietDays(memory.todayShownAt, now) && !sameLocalDay(memory.todayShownAt, now)) return null;
  return kindFor(input.permission);
}

/** True when a new showing starts now, so the caller records it once per showing. */
export function startsTodayShowing(memory: ReminderAskMemory, now: Date): boolean {
  return !sameLocalDay(memory.todayShownAt, now);
}
