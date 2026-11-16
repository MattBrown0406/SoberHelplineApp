/**
 * "Good to see you": one small card at the top of Today when she opens the
 * app after a week or more away. It never says how long it has been, and it
 * offers only what is useful right now. Pure, so tests pin the rules.
 */
export const WELCOME_BACK_AFTER_DAYS = 7;

const DAY_MS = 86_400_000;

/** Kept on the device, per account, so deleting the account removes it. */
export function lastOpenedStorageKey(accountId: string): string {
  return `@sh:last-opened:${accountId}`;
}

/**
 * True when the last time she had the app open was seven or more days ago.
 * No record (a new member, a new phone) or an unreadable one is not a return.
 */
export function isReturnAfterAbsence(lastOpenedAt: string | null | undefined, now: Date): boolean {
  const last = lastOpenedAt ? Date.parse(lastOpenedAt) : Number.NaN;
  if (!Number.isFinite(last)) return false;
  return now.getTime() - last >= WELCOME_BACK_AFTER_DAYS * DAY_MS;
}

export type WelcomeBackAction = 'saveSeat' | 'checkIn';

/** The actions worth offering right now; none of them is ever a reminder of what she missed. */
export function welcomeBackActions(input: {
  /** The coming Monday meeting can be saved and she has not answered for it. */
  seatOpen: boolean;
  checkedInToday: boolean;
}): WelcomeBackAction[] {
  const actions: WelcomeBackAction[] = [];
  if (input.seatOpen) actions.push('saveSeat');
  if (!input.checkedInToday) actions.push('checkIn');
  return actions;
}
