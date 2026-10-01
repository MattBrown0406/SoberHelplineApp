// Receptivity forecast — pure and deterministic. Shared by the app (Today and
// Invitation Engine cards) and the invitation-window-push Edge Function.
//
// KEEP IN SYNC with src/lib/invitationForecast.ts: the app cannot import from
// supabase/functions (Metro/EAS) and Edge Functions cannot import from src/ on
// deploy, so the module exists twice. tests/invitation-forecast.test.ts runs
// both copies over the same generated inputs and fails on any divergence.
//
// It combines, for one member and one moment:
//   • the 72-hour willingness window after a logged consequence
//   • tracker trend (recovery signs up / warning signs down vs last week)
//   • the pattern map's sober times (time of day / weekend)
//   • daily-move consistency over the last 7 days
//   • the optional "How are they today?" check (calm / okay / rough)
// A serious safety concern overrides everything: no window, ever.

export const FORECAST_LEVELS = ['low', 'possible', 'good'] as const;
export type ForecastLevel = typeof FORECAST_LEVELS[number];

export const SOBER_TIMES = ['morning', 'afternoon', 'evening', 'weekend'] as const;
export type SoberTime = typeof SOBER_TIMES[number];

export const QUICK_CHECKS = ['calm', 'okay', 'rough'] as const;
export type QuickCheck = typeof QUICK_CHECKS[number];

export const WINDOW_SOURCES = ['consequence', 'trend', 'sober_time', 'consistency', 'calm'] as const;
export type WindowSource = typeof WINDOW_SOURCES[number];

export type DayPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

export type ForecastReasonCode =
  | 'safetyHold'
  | 'consequenceWindow'
  | 'trendImproving'
  | 'trendWorsening'
  | 'soberTimeNow'
  | 'soberTimeLater'
  | 'soberTimeOther'
  | 'soberTimeUnknown'
  | 'consistent'
  | 'buildingConsistency'
  | 'noMovesYet'
  | 'calmToday'
  | 'okayToday'
  | 'roughToday'
  | 'noCheckToday'
  | 'restingUntil'
  | 'inTreatment'
  | 'returningHome'
  | 'inRecovery'
  | 'afterYes';

export type ForecastReason = {
  code: ForecastReasonCode;
  effect: 'up' | 'down' | 'neutral';
  params?: { hours?: number; days?: number; period?: SoberTime };
};

export type ForecastInput = {
  nowMs: number;
  /** Member-local hour, 0–23. */
  localHour: number;
  /** Member-local weekday, 0 = Sunday … 6 = Saturday. */
  localWeekday: number;
  latestConsequenceAt: string | null;
  /** Tracker signs logged so far this week (Monday-based, member-local). */
  warningThisWeek: number;
  /** Last week's signs logged by the same weekday, for a like-for-like trend. */
  warningLastWeek: number;
  recoveryThisWeek: number;
  recoveryLastWeek: number;
  soberTimes: readonly string[];
  /** Distinct days in the last 7 with at least one daily move done. */
  moveDaysLast7: number;
  todayCheck: string | null;
  /** This member's own 'serious' safety answer (never a family member's). */
  safetySerious: boolean;
  /** Member-local calendar date (YYYY-MM-DD) the forecast is for. */
  localDate: string;
  /**
   * The latest yes / not yet / angry logged by her or her family space, the
   * day it happened, and its suggested next window.
   */
  lastOutcome: string | null;
  lastOutcomeDate: string | null;
  nextWindowDate: string | null;
  /**
   * The family's effective recovery phase (snapshot.recovery_phase: the most
   * recently updated loved-one record in her family space, normalized like
   * effectiveRecoveryPhase).
   */
  recoveryPhase: string | null;
};

/** Why invitation windows are switched off entirely right now, if they are. */
export type ForecastPause = 'in_treatment' | 'returning_home' | 'in_recovery' | 'after_yes';

const RECOVERY_PHASES = [
  'active_use', 'considering_treatment', 'in_treatment', 'returning_home', 'early_recovery_30',
  'early_recovery_90', 'ongoing_recovery', 'return_to_use', 'unsure',
];
const ACTIVE_USE_STATUSES = ['using', 'escalating', 'crisis'];

/**
 * The loved one's effective phase — mirrors normalizeRecoveryPhase in
 * src/lib/recoveryPathway.ts and _invitation_recovery_phase() in SQL (tests
 * keep all three equal). The pathway card writes stage; status only decides
 * for a legacy or blank stage.
 */
export function effectiveRecoveryPhase(stage: string | null | undefined, status: string | null | undefined): string {
  if (stage && RECOVERY_PHASES.includes(stage)) return stage;
  if (stage === 'using') return 'active_use';
  if (stage === 'seeking_help') return 'considering_treatment';
  if (stage === 'recovery') return ACTIVE_USE_STATUSES.includes(status ?? '') ? 'return_to_use' : 'early_recovery_30';
  if (status === 'in_treatment') return 'in_treatment';
  if (ACTIVE_USE_STATUSES.includes(status ?? '')) return 'active_use';
  return 'unsure';
}

/** Phases after a yes: the engine stops suggesting invitations. */
export function recoveryPause(phase: string): ForecastPause | null {
  if (phase === 'in_treatment') return 'in_treatment';
  if (phase === 'returning_home') return 'returning_home';
  if (phase === 'early_recovery_30' || phase === 'early_recovery_90' || phase === 'ongoing_recovery') return 'in_recovery';
  return null;
}

const PAUSE_REASON: Record<ForecastPause, ForecastReasonCode> = {
  in_treatment: 'inTreatment',
  returning_home: 'returningHome',
  in_recovery: 'inRecovery',
  after_yes: 'afterYes',
};

export type Forecast = {
  level: ForecastLevel;
  score: number;
  reasons: ForecastReason[];
  sources: WindowSource[];
  safetyHold: boolean;
  paused: ForecastPause | null;
};

export const FORECAST_WEIGHTS = {
  base: 20,
  consequence: 30,
  trendStrong: 15,
  trendMild: 8,
  trendWorse: -10,
  soberNow: 15,
  soberLater: 12,
  soberOther: -5,
  consistent: 10,
  building: 5,
  calm: 15,
  okay: 5,
  rough: -25,
} as const;

export const GOOD_WINDOW_SCORE = 65;
export const POSSIBLE_WINDOW_SCORE = 40;
export const CONSEQUENCE_WINDOW_MS = 72 * 60 * 60 * 1000;
/** After a yes, invitation windows stay off this long unless a new outcome is logged. */
export const AFTER_YES_PAUSE_DAYS = 30;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

function count(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function dayPeriod(localHour: number): DayPeriod {
  const hour = Number.isFinite(localHour) ? ((Math.floor(localHour) % 24) + 24) % 24 : 12;
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

/** Parts of the day still ahead today, in order. */
export function laterPeriods(localHour: number): SoberTime[] {
  const hour = Number.isFinite(localHour) ? ((Math.floor(localHour) % 24) + 24) % 24 : 12;
  if (hour < 5) return ['morning', 'afternoon', 'evening'];
  const period = dayPeriod(hour);
  if (period === 'morning') return ['afternoon', 'evening'];
  if (period === 'afternoon') return ['evening'];
  return [];
}

/** Whole days from one YYYY-MM-DD date to another (NaN for junk). */
export function daysBetween(from: string, to: string): number {
  const parse = (value: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : Number.NaN;
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

export function forecastLevelForScore(score: number): ForecastLevel {
  if (score >= GOOD_WINDOW_SCORE) return 'good';
  if (score >= POSSIBLE_WINDOW_SCORE) return 'possible';
  return 'low';
}

export function scoreReceptivity(input: ForecastInput): Forecast {
  if (input.safetySerious) {
    return {
      level: 'low',
      score: 0,
      reasons: [{ code: 'safetyHold', effect: 'down' }],
      sources: [],
      safetyHold: true,
      paused: null,
    };
  }

  // In treatment, coming home, in recovery, or a recent family yes: no
  // invitation windows at all.
  const sinceOutcome = input.lastOutcomeDate ? daysBetween(input.lastOutcomeDate, input.localDate) : Number.NaN;
  const phasePause = input.recoveryPhase ? recoveryPause(input.recoveryPhase) : null;
  const paused: ForecastPause | null = phasePause
    ?? (input.lastOutcome === 'yes' && Number.isFinite(sinceOutcome) && sinceOutcome < AFTER_YES_PAUSE_DAYS
      ? 'after_yes'
      : null);
  if (paused) {
    return {
      level: 'low',
      score: 0,
      reasons: [{ code: PAUSE_REASON[paused], effect: 'neutral' }],
      sources: [],
      safetyHold: false,
      paused,
    };
  }

  const w = FORECAST_WEIGHTS;
  let score: number = w.base;
  const reasons: ForecastReason[] = [];
  const sources: WindowSource[] = [];

  // 1. A concrete consequence in the last 72 hours can open a short window.
  const occurred = input.latestConsequenceAt ? Date.parse(input.latestConsequenceAt) : Number.NaN;
  if (Number.isFinite(occurred)) {
    const elapsed = input.nowMs - occurred;
    if (elapsed >= -CLOCK_SKEW_MS && elapsed < CONSEQUENCE_WINDOW_MS) {
      score += w.consequence;
      const hours = Math.max(1, Math.ceil((CONSEQUENCE_WINDOW_MS - elapsed) / (60 * 60 * 1000)));
      reasons.push({ code: 'consequenceWindow', effect: 'up', params: { hours } });
      sources.push('consequence');
    }
  }

  // 2. Tracker trend: recovery signs up and warning signs down this week.
  // Only once this week has entries: an empty (or not-yet-filled) week must
  // never read as "improving" on a bad last week. The server compares against
  // last week up to the same weekday.
  const loggedThisWeek = count(input.warningThisWeek) + count(input.recoveryThisWeek) > 0;
  const delta = (count(input.recoveryThisWeek) - count(input.recoveryLastWeek))
    - (count(input.warningThisWeek) - count(input.warningLastWeek));
  if (!loggedThisWeek) {
    // No trend signal yet this week.
  } else if (delta >= 2) {
    score += w.trendStrong;
    reasons.push({ code: 'trendImproving', effect: 'up' });
    sources.push('trend');
  } else if (delta === 1) {
    score += w.trendMild;
    reasons.push({ code: 'trendImproving', effect: 'up' });
    sources.push('trend');
  } else if (delta <= -2) {
    score += w.trendWorse;
    reasons.push({ code: 'trendWorsening', effect: 'down' });
  }

  // 3. Sober, reachable times from the pattern map.
  const times = SOBER_TIMES.filter((time) => input.soberTimes.includes(time));
  if (!times.length) {
    reasons.push({ code: 'soberTimeUnknown', effect: 'neutral' });
  } else {
    const weekend = input.localWeekday === 0 || input.localWeekday === 6;
    const period = dayPeriod(input.localHour);
    if (weekend && times.includes('weekend')) {
      score += w.soberNow;
      reasons.push({ code: 'soberTimeNow', effect: 'up', params: { period: 'weekend' } });
      sources.push('sober_time');
    } else if (period !== 'night' && times.includes(period)) {
      score += w.soberNow;
      reasons.push({ code: 'soberTimeNow', effect: 'up', params: { period } });
      sources.push('sober_time');
    } else {
      const later = laterPeriods(input.localHour).find((time) => times.includes(time));
      if (later) {
        score += w.soberLater;
        reasons.push({ code: 'soberTimeLater', effect: 'up', params: { period: later } });
        sources.push('sober_time');
      } else {
        score += w.soberOther;
        reasons.push({ code: 'soberTimeOther', effect: 'down', params: { period: times[0] } });
      }
    }
  }

  // 4. Consistency: the family's daily moves change the climate first.
  const days = Math.min(7, count(input.moveDaysLast7));
  if (days >= 4) {
    score += w.consistent;
    reasons.push({ code: 'consistent', effect: 'up', params: { days } });
    sources.push('consistency');
  } else if (days >= 2) {
    score += w.building;
    reasons.push({ code: 'buildingConsistency', effect: 'up', params: { days } });
  } else {
    reasons.push({ code: 'noMovesYet', effect: 'neutral', params: { days } });
  }

  // 5. The family's own read on today.
  const check = input.todayCheck;
  if (check === 'calm') {
    score += w.calm;
    reasons.push({ code: 'calmToday', effect: 'up' });
    sources.push('calm');
  } else if (check === 'okay') {
    score += w.okay;
    reasons.push({ code: 'okayToday', effect: 'up' });
  } else if (check === 'rough') {
    score += w.rough;
    reasons.push({ code: 'roughToday', effect: 'down' });
  } else {
    reasons.push({ code: 'noCheckToday', effect: 'neutral' });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  // After "not yet" or anger, rest until the suggested next window.
  const restDays = (input.lastOutcome === 'not_yet' || input.lastOutcome === 'angry') && input.nextWindowDate
    ? daysBetween(input.localDate, input.nextWindowDate)
    : Number.NaN;
  const resting = Number.isFinite(restDays) && restDays > 0;
  if (resting) reasons.unshift({ code: 'restingUntil', effect: 'down', params: { days: restDays } });
  // A rough day or a rest period is never a window, whatever else lines up.
  const level = check === 'rough' || resting ? 'low' : forecastLevelForScore(score);
  // Lead with what moved the level: lifts for a window, drags for a low day.
  const first = level === 'low' ? 'down' : 'up';
  const second = level === 'low' ? 'up' : 'down';
  const ordered = [
    ...reasons.filter((reason) => reason.effect === first),
    ...reasons.filter((reason) => reason.effect === second),
    ...reasons.filter((reason) => reason.effect === 'neutral'),
  ];
  return { level, score, reasons: ordered, sources, safetyHold: false, paused: null };
}
