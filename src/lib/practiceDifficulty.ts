import type { PartnerTemperament } from './practiceScenarios';
import { averageScore, isWarmupScenario, readScores, type SavedSessionRow, type ScoreSet } from './practiceTrends';

/**
 * Adaptive difficulty over the partner's existing temperaments, easiest first:
 * guarded (minimizes) → tearful (pulls you into comforting) → defensive
 * (argues every word) → volatile (erupts, threatens to walk out).
 */
export const DIFFICULTY_LADDER: readonly PartnerTemperament[] = ['guarded', 'tearful', 'defensive', 'volatile'];

export type DifficultyAction = 'up' | 'stay' | 'down';
export type DifficultyReason = 'strong' | 'steady' | 'struggling' | 'first' | 'top' | 'bottom';
export type DifficultyAdvice = {
  action: DifficultyAction;
  current: PartnerTemperament;
  suggested: PartnerTemperament;
  reason: DifficultyReason;
};

export type SessionScore = { temperament: PartnerTemperament; scores: ScoreSet };

/** Two reps in a row averaging this (with nothing below 3) earn the next level. */
export const STEP_UP_AVERAGE = 3.75;
/** One standout rep (no score below 4) is enough on its own. */
export const STANDOUT_AVERAGE = 4.5;
/** A rep this rough suggests stepping down to rebuild footing. */
export const STEP_DOWN_AVERAGE = 2.25;

export function difficultyIndex(level: PartnerTemperament): number {
  return DIFFICULTY_LADDER.indexOf(level);
}

function minScore(scores: ScoreSet): number {
  return Math.min(scores.love, scores.ask, scores.boundaries, scores.calm);
}

/**
 * Recommends the next level from recent sessions (newest first). Only reps at
 * the current level count — a strong rep against "Guarded" says nothing about
 * readiness for "Heated" if they've already moved past it.
 */
export function recommendDifficulty(current: PartnerTemperament, recent: readonly SessionScore[]): DifficultyAdvice {
  const at = recent.filter((s) => s.temperament === current).slice(0, 3);
  const index = Math.max(0, difficultyIndex(current));
  const up = DIFFICULTY_LADDER[Math.min(DIFFICULTY_LADDER.length - 1, index + 1)];
  const down = DIFFICULTY_LADDER[Math.max(0, index - 1)];
  const stay = (reason: DifficultyReason): DifficultyAdvice => ({ action: 'stay', current, suggested: current, reason });

  if (at.length === 0) return stay('first');
  const newest = at[0].scores;
  if (averageScore(newest) <= STEP_DOWN_AVERAGE || minScore(newest) <= 1) {
    return index === 0 ? stay('bottom') : { action: 'down', current, suggested: down, reason: 'struggling' };
  }
  const standout = averageScore(newest) >= STANDOUT_AVERAGE && minScore(newest) >= 4;
  const twoStrong = at.length >= 2 &&
    at.slice(0, 2).every((s) => averageScore(s.scores) >= STEP_UP_AVERAGE && minScore(s.scores) >= 3);
  if (standout || twoStrong) {
    return index === DIFFICULTY_LADDER.length - 1
      ? stay('top')
      : { action: 'up', current, suggested: up, reason: 'strong' };
  }
  return stay(at.length === 1 ? 'first' : 'steady');
}

/**
 * Saved rows (newest first) → scored, full-length sessions the member chose
 * the level for. Incoming calls roll a random temperament, so they say
 * nothing about which level she is ready for.
 */
export function sessionScoresFromRows(rows: readonly SavedSessionRow[]): SessionScore[] {
  const out: SessionScore[] = [];
  for (const row of rows) {
    if (isWarmupScenario(row.scenario)) continue;
    if ((row.scenario as { mode?: unknown } | null | undefined)?.mode === 'incoming_call') continue;
    const temperament = (row.scenario as { temperament?: unknown } | null | undefined)?.temperament;
    if (typeof temperament !== 'string' || !(DIFFICULTY_LADDER as readonly string[]).includes(temperament)) continue;
    const scores = readScores(row.debrief);
    if (scores) out.push({ temperament: temperament as PartnerTemperament, scores });
  }
  return out;
}

/**
 * Where to start the next practice: re-run the advice for the level they
 * practiced most recently. Null without history.
 */
export function suggestedStartingLevel(recent: readonly SessionScore[]): DifficultyAdvice | null {
  if (recent.length === 0) return null;
  return recommendDifficulty(recent[0].temperament, recent);
}
