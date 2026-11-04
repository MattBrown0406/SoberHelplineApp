import { holidaySeason } from './holidayPlan';

/**
 * When Today asks where things stand with her loved one. Signup lets her skip
 * that step and nearly everyone does, so without a later ask every
 * situation-aware surface (support doors, the curriculum's crisis guard, the
 * invitation engine) runs on defaults. Pure, so tests can pin the rules.
 */
export const LOVED_ONE_CHECK_STALE_DAYS = 30;
/** A heavy check-in re-asks sooner than the monthly check. */
export const LOVED_ONE_CHECK_PRESSURE_DAYS = 7;
export const LOVED_ONE_CHECK_PRESSURE_SCORE = 4;
export const LOVED_ONE_CHECK_SNOOZE_DAYS = 7;

const DAY_MS = 86_400_000;

export type LovedOneCheckReason = 'missing' | 'stale' | 'pressure';

export function lovedOneCheckDue(input: {
  hasRecord: boolean;
  stage: string | null | undefined;
  updatedAt: string | null | undefined;
  pressureScore: number | null | undefined;
  snoozedUntil: string | null;
  now: Date;
}): LovedOneCheckReason | null {
  const nowMs = input.now.getTime();
  const snoozedUntil = input.snoozedUntil ? Date.parse(input.snoozedUntil) : Number.NaN;
  if (Number.isFinite(snoozedUntil) && snoozedUntil > nowMs) return null;
  if (!input.hasRecord || !input.stage) return 'missing';
  const updatedMs = input.updatedAt ? Date.parse(input.updatedAt) : Number.NaN;
  // An unreadable timestamp is treated as old: asking once is cheap.
  const ageDays = Number.isFinite(updatedMs) ? (nowMs - updatedMs) / DAY_MS : Number.POSITIVE_INFINITY;
  if ((input.pressureScore ?? 0) >= LOVED_ONE_CHECK_PRESSURE_SCORE && ageDays >= LOVED_ONE_CHECK_PRESSURE_DAYS) {
    return 'pressure';
  }
  return ageDays >= LOVED_ONE_CHECK_STALE_DAYS ? 'stale' : null;
}

export function lovedOneCheckSnoozeUntil(now: Date): string {
  return new Date(now.getTime() + LOVED_ONE_CHECK_SNOOZE_DAYS * DAY_MS).toISOString();
}

export function lovedOneCheckStorageKey(accountId: string): string {
  return `@sh:loved-one-check:${accountId}`;
}

export function holidayCardStorageKey(accountId: string): string {
  return `@sh:holiday-card:${accountId}`;
}

/** The holiday card shows in season until the plan is ready or she hides it for the season. */
export function holidayCardVisible(input: {
  now: Date;
  planReady: boolean;
  dismissedSeason: string | null;
}): boolean {
  const { active, season } = holidaySeason(input.now);
  return active && !input.planReady && input.dismissedSeason !== season;
}
