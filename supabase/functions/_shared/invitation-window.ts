// Evening "Tonight may be a window" push: turn one candidate row from
// invitation_window_push_candidates() into a decision and localized copy.
// Pure — the Edge Function does the IO.

import {
  type Forecast,
  type ForecastInput,
  scoreReceptivity,
} from './invitation-forecast.ts';

export type WindowCandidate = {
  account_id: string;
  locale: string | null;
  local_date: string;
  local_hour: number;
  local_weekday: number;
  snapshot: unknown;
};

export type WindowDecision = {
  push: boolean;
  forecast: Forecast;
  skipped?: 'safety' | 'incomplete' | 'paused' | 'not_good';
};

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : 0;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** Forecast inputs from the my_invitation_engine / candidate snapshot shape. */
export function forecastInputFromSnapshot(
  snapshot: unknown,
  clock: { nowMs: number; localHour: number; localWeekday: number; localDate: string },
): ForecastInput {
  const root = obj(snapshot);
  const inputs = obj(root.inputs);
  const signals = obj(obj(root.plan).signals);
  const today = obj(root.today);
  const profile = obj(root.profile);
  // Family-level outcome gate (her own or her family space's latest yes /
  // not yet / angry), not just her own last log.
  const attempt = obj(root.outcome_gate);
  const consequence = inputs.latest_consequence_at;
  const text = (value: unknown) => (typeof value === 'string' && value ? value : null);
  return {
    nowMs: clock.nowMs,
    localHour: clock.localHour,
    localWeekday: clock.localWeekday,
    latestConsequenceAt: typeof consequence === 'string' ? consequence : null,
    warningThisWeek: num(inputs.warning_this_week),
    warningLastWeek: num(inputs.warning_last_week),
    recoveryThisWeek: num(inputs.recovery_this_week),
    recoveryLastWeek: num(inputs.recovery_last_week),
    soberTimes: strings(signals.sober_times),
    moveDaysLast7: num(inputs.move_days_7),
    todayCheck: typeof today.check === 'string' ? today.check : null,
    // The member's own answer only; a missing flag is treated as safety-first.
    safetySerious: root.safety_first !== false || profile.safety_concern === 'serious',
    localDate: clock.localDate,
    lastOutcome: text(attempt.outcome),
    lastOutcomeDate: text(attempt.local_date),
    nextWindowDate: text(attempt.next_window_date),
    recoveryPhase: text(root.recovery_phase),
  };
}

export function evaluateWindowCandidate(candidate: WindowCandidate, nowMs: number): WindowDecision {
  const input = forecastInputFromSnapshot(candidate.snapshot, {
    nowMs,
    localHour: candidate.local_hour,
    localWeekday: candidate.local_weekday,
    localDate: candidate.local_date,
  });
  const forecast = scoreReceptivity(input);
  if (forecast.safetyHold) return { push: false, forecast, skipped: 'safety' };
  if (forecast.paused) return { push: false, forecast, skipped: 'paused' };
  const profile = obj(obj(candidate.snapshot).profile);
  if (profile.completed !== true) return { push: false, forecast, skipped: 'incomplete' };
  if (forecast.level !== 'good') return { push: false, forecast, skipped: 'not_good' };
  return { push: true, forecast };
}

// The notification is readable on a lock screen the loved one may see, so it
// never mentions treatment, sobriety, using or an invitation. The engine says
// "Tonight may be a window" only once the member opens the app.
const COPY = {
  en: { title: 'Sober Helpline', body: 'You have a note for today.' },
  es: { title: 'Sober Helpline', body: 'Tienes una nota para hoy.' },
} as const;

/** Words a lock-screen-visible window push must never contain (EN + ES). */
export const LOCK_SCREEN_FORBIDDEN = /sober|sobri|using|drink|drug|treatment|rehab|invit|addict|window|consum|tratamiento|invita|ventana|adicci|droga|alcohol/i;

/** Server pushes are localized from accounts.locale ('es%' → Spanish). */
export function windowPushCopy(locale: string | null | undefined): { title: string; body: string } {
  return (locale ?? 'en').toLowerCase().startsWith('es') ? COPY.es : COPY.en;
}
