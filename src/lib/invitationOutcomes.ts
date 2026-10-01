/**
 * Invitation Engine — the outcome loop: what a family logs after an attempt,
 * the next suggested window, the repair plan, and the simple per-family
 * learning ("what preceded better outcomes"). Pure.
 */
import { WINDOW_SOURCES, type ForecastLevel, type WindowSource } from './invitationForecast';
import type { SoberTime } from './lovedOneProfile';

export const INVITATION_OUTCOMES = ['yes', 'not_yet', 'angry', 'didnt_get_to_it'] as const;
export type InvitationOutcome = typeof INVITATION_OUTCOMES[number];

export const LINE_STYLE_CHOICES = ['warm', 'observation', 'help', 'own'] as const;
export type LineStyleChoice = typeof LINE_STYLE_CHOICES[number];

export const OUTCOME_NOTE_MAX = 500;

export function isInvitationOutcome(value: unknown): value is InvitationOutcome {
  return typeof value === 'string' && (INVITATION_OUTCOMES as readonly string[]).includes(value);
}

export function isLineStyleChoice(value: unknown): value is LineStyleChoice {
  return typeof value === 'string' && (LINE_STYLE_CHOICES as readonly string[]).includes(value);
}

function shiftDate(localDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return localDate;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekdayOf(localDate: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) return 0;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

/** When the member asked, relative to the day they log it. */
export const ASK_DAYS = ['today', 'yesterday'] as const;
export type AskDay = typeof ASK_DAYS[number];

/**
 * The local date the invitation happened on. The server attributes the
 * attempt to the forecast recorded for that day (its best window), so a
 * "yes" logged the next morning still credits last night's window.
 */
export function askDate(today: string, when: AskDay): string {
  return when === 'yesterday' ? shiftDate(today, -1) : today;
}

/** Days to wait before the next invitation, by how the last one went. */
export const NEXT_WINDOW_GAP_DAYS: Readonly<Record<Exclude<InvitationOutcome, 'yes'>, number>> = {
  // A "not yet" is a seed planted; give it a few days of warmth to grow.
  not_yet: 3,
  // Anger needs a longer cool-down and some repair first.
  angry: 7,
  // Nothing happened: the next calm moment is fine.
  didnt_get_to_it: 1,
};

/**
 * The suggested next window (YYYY-MM-DD), or null after a yes. When the family
 * knows weekends are when their loved one is reachable, a not-yet/angry window
 * moves to the next Saturday on or after the minimum gap.
 */
export function suggestNextWindowDate(
  outcome: InvitationOutcome,
  localDate: string,
  soberTimes: readonly SoberTime[] = [],
): string | null {
  if (outcome === 'yes') return null;
  const base = shiftDate(localDate, NEXT_WINDOW_GAP_DAYS[outcome]);
  if (outcome === 'didnt_get_to_it' || !soberTimes.includes('weekend')) return base;
  const toSaturday = (6 - weekdayOf(base) + 7) % 7;
  return shiftDate(base, toSaturday);
}

/** Locale keys (invitation:outcome.repair.<outcome>.<n>) for the repair plan. */
export function repairPlanKeys(outcome: InvitationOutcome): string[] {
  if (outcome === 'yes') return [];
  return [1, 2, 3].map((step) => `outcome.repair.${outcome}.${step}`);
}

export type LearningAttempt = {
  outcome: InvitationOutcome;
  windowSources: string[];
  lineStyle: string | null;
  createdAt: string;
  mine: boolean;
};

export type LearningRow<K extends string> = {
  key: K;
  asks: number;
  yes: number;
  notYet: number;
  angry: number;
};

export type LearningSummary = {
  asks: number;
  yes: number;
  bySource: LearningRow<WindowSource | 'none'>[];
  byStyle: LearningRow<LineStyleChoice>[];
};

export function parseLearningRows(raw: unknown): LearningAttempt[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Record<string, unknown>;
    if (!isInvitationOutcome(r.outcome) || typeof r.created_at !== 'string') return [];
    return [{
      outcome: r.outcome,
      windowSources: Array.isArray(r.window_sources)
        ? r.window_sources.filter((source): source is string => typeof source === 'string')
        : [],
      lineStyle: typeof r.line_style === 'string' ? r.line_style : null,
      createdAt: r.created_at,
      mine: r.mine === true,
    }];
  });
}

function emptyRow<K extends string>(key: K): LearningRow<K> {
  return { key, asks: 0, yes: 0, notYet: 0, angry: 0 };
}

function tally<K extends string>(row: LearningRow<K>, outcome: InvitationOutcome): void {
  row.asks += 1;
  if (outcome === 'yes') row.yes += 1;
  if (outcome === 'not_yet') row.notYet += 1;
  if (outcome === 'angry') row.angry += 1;
}

/** Better outcomes first: more yeses, then a higher yes share, then fewer angry, then more asks. */
function rank<K extends string>(rows: LearningRow<K>[]): LearningRow<K>[] {
  return rows
    .filter((row) => row.asks > 0)
    .sort((a, b) => (b.yes - a.yes) || (b.yes / b.asks - a.yes / a.asks) || (a.angry - b.angry)
      || (b.asks - a.asks) || a.key.localeCompare(b.key));
}

/**
 * Simple counts of what preceded each outcome across the family plan. Only
 * real asks count ("didn't get to it" is not an attempt).
 */
export function learningSummary(attempts: readonly LearningAttempt[]): LearningSummary {
  const sources = new Map<WindowSource | 'none', LearningRow<WindowSource | 'none'>>();
  const styles = new Map<LineStyleChoice, LearningRow<LineStyleChoice>>();
  let asks = 0;
  let yes = 0;
  for (const attempt of attempts) {
    if (attempt.outcome === 'didnt_get_to_it') continue;
    asks += 1;
    if (attempt.outcome === 'yes') yes += 1;
    const known = WINDOW_SOURCES.filter((source) => attempt.windowSources.includes(source));
    for (const source of known.length ? known : ['none' as const]) {
      const row = sources.get(source) ?? emptyRow(source);
      tally(row, attempt.outcome);
      sources.set(source, row);
    }
    if (isLineStyleChoice(attempt.lineStyle)) {
      const row = styles.get(attempt.lineStyle) ?? emptyRow(attempt.lineStyle);
      tally(row, attempt.outcome);
      styles.set(attempt.lineStyle, row);
    }
  }
  return { asks, yes, bySource: rank([...sources.values()]), byStyle: rank([...styles.values()]) };
}

export type ProgressAttempt = { outcome: InvitationOutcome; createdAt: string; note: string | null; localDate: string };
export type ProgressForecast = { localDate: string; level: ForecastLevel; pushed: boolean };

export function parseProgressAttempts(raw: unknown): ProgressAttempt[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Record<string, unknown>;
    if (!isInvitationOutcome(r.outcome) || typeof r.created_at !== 'string') return [];
    return [{
      outcome: r.outcome,
      createdAt: r.created_at,
      note: typeof r.note === 'string' && r.note ? r.note : null,
      localDate: typeof r.local_date === 'string' ? r.local_date : r.created_at.slice(0, 10),
    }];
  });
}

export function parseProgressForecasts(raw: unknown): ProgressForecast[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Record<string, unknown>;
    const level = r.level;
    if (typeof r.local_date !== 'string' || (level !== 'low' && level !== 'possible' && level !== 'good')) return [];
    return [{ localDate: r.local_date, level, pushed: typeof r.pushed_at === 'string' }];
  });
}

export type ProgressSummary = {
  attempts: number;
  outcomes: Record<InvitationOutcome, number>;
  movesDone: number;
  moveDays: number;
  goodDays: number;
};

export function progressSummary(
  attempts: readonly ProgressAttempt[],
  moveDates: readonly string[],
  forecasts: readonly ProgressForecast[],
): ProgressSummary {
  const outcomes: Record<InvitationOutcome, number> = { yes: 0, not_yet: 0, angry: 0, didnt_get_to_it: 0 };
  for (const attempt of attempts) outcomes[attempt.outcome] += 1;
  return {
    attempts: attempts.length,
    outcomes,
    movesDone: moveDates.length,
    moveDays: new Set(moveDates).size,
    goodDays: forecasts.filter((forecast) => forecast.level === 'good').length,
  };
}
