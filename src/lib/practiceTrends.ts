/**
 * Score history for conversation practice: the four coaching scores (1–5)
 * read defensively from saved sessions, and their trend over time.
 */

export const SCORE_KEYS = ['love', 'ask', 'boundaries', 'calm'] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];
export type ScoreSet = Record<ScoreKey, number>;

/** Saved debriefs are jsonb written by older and newer app versions alike — never trust their shape. */
export function readScores(debrief: unknown): ScoreSet | null {
  if (!debrief || typeof debrief !== 'object') return null;
  const scores = (debrief as { scores?: unknown }).scores;
  if (!scores || typeof scores !== 'object') return null;
  const out = {} as ScoreSet;
  for (const key of SCORE_KEYS) {
    const value = (scores as Record<string, unknown>)[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    out[key] = Math.min(5, Math.max(1, Math.round(value)));
  }
  return out;
}

export function averageScore(scores: ScoreSet): number {
  return SCORE_KEYS.reduce((sum, key) => sum + scores[key], 0) / SCORE_KEYS.length;
}

/** Warm-ups are 90-second, three-exchange reps — too short to count toward trends or difficulty. */
export function isWarmupScenario(scenario: unknown): boolean {
  return !!scenario && typeof scenario === 'object' && (scenario as { warmup?: unknown }).warmup === true;
}

export type SavedSessionRow = { created_at: string; scenario?: unknown; debrief?: unknown };
export type TrendPoint = { at: string; scores: ScoreSet };
export type ScoreTrend = {
  /** Oldest first, at most `max` full sessions. */
  points: TrendPoint[];
  /** Latest minus first, per score; null until there are two points. */
  change: ScoreSet | null;
};

export const TREND_MAX_POINTS = 10;

/** Rows arrive newest first (as the history screen loads them). */
export function scoreTrend(rows: readonly SavedSessionRow[], max = TREND_MAX_POINTS): ScoreTrend {
  const points: TrendPoint[] = [];
  for (const row of rows) {
    if (isWarmupScenario(row.scenario)) continue;
    const scores = readScores(row.debrief);
    if (!scores) continue;
    points.push({ at: row.created_at, scores });
    if (points.length >= max) break;
  }
  points.reverse();
  if (points.length < 2) return { points, change: null };
  const first = points[0].scores;
  const last = points[points.length - 1].scores;
  const change = {} as ScoreSet;
  for (const key of SCORE_KEYS) change[key] = last[key] - first[key];
  return { points, change };
}
