/**
 * Invitation Engine — pure client helpers around the my_invitation_engine()
 * snapshot: parsing, the member-local clock, forecast inputs and the stage the
 * engine screen should show.
 */
import type { ForecastInput, ForecastLevel, QuickCheck } from './invitationForecast';
import { type PlanSignals } from './invitationMoves';
import { SOBER_TIME_OPTIONS, type SoberTime } from './lovedOneProfile';
import { INVITATION_OUTCOMES, type InvitationOutcome } from './invitationOutcomes';

export type EngineSnapshot = {
  localDate: string;
  hasAccess: boolean;
  profile: { saved: boolean; completed: boolean; safetyConcern: string };
  state: { setupCompletedAt: string | null; windowPushOptIn: boolean; lastWindowPushAt: string | null };
  plan: {
    scope: 'family' | 'solo';
    seed: string;
    members: number;
    /** Family signals; safetySerious is this member's own answer, never a relative's. */
    signals: PlanSignals;
    soberTimes: SoberTime[];
  };
  /** This member's own safety-first path (an unknown value counts as true). */
  safetyFirst: boolean;
  /** The family's effective recovery phase (most recently updated loved-one record in the space). */
  recoveryPhase: string | null;
  /** Latest yes / not yet / angry logged by her or her family space (outcome and dates only). */
  outcomeGate: { outcome: InvitationOutcome; localDate: string; nextWindowDate: string | null } | null;
  today: {
    movesDone: string[];
    check: QuickCheck | null;
    /** The day's best recorded forecast so far, if any. */
    forecast: { level: ForecastLevel; score: number } | null;
  };
  inputs: {
    latestConsequenceAt: string | null;
    warningThisWeek: number;
    warningLastWeek: number;
    recoveryThisWeek: number;
    recoveryLastWeek: number;
    moveDaysLast7: number;
  };
  lastAttempt: {
    outcome: InvitationOutcome;
    localDate: string;
    createdAt: string;
    nextWindowDate: string | null;
  } | null;
};

export type EngineStage = 'map' | 'safety' | 'paywall' | 'finishSetup' | 'active';

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseEngineSnapshot(raw: unknown): EngineSnapshot | null {
  const root = obj(raw);
  const localDate = str(root.local_date);
  if (!localDate || !DATE_PATTERN.test(localDate)) return null;
  const profile = obj(root.profile);
  const state = obj(root.state);
  const plan = obj(root.plan);
  const signals = obj(plan.signals);
  const today = obj(root.today);
  const inputs = obj(root.inputs);
  const attempt = obj(root.last_attempt);
  const gate = obj(root.outcome_gate);
  const check = today.check;
  const outcome = attempt.outcome;
  const soberTimes = SOBER_TIME_OPTIONS.filter((time) => strings(signals.sober_times).includes(time));
  const safetyFirst = root.safety_first !== false || profile.safety_concern === 'serious';
  const recorded = obj(today.forecast);
  const recordedLevel = recorded.level;
  return {
    localDate,
    hasAccess: root.has_access === true,
    profile: {
      saved: profile.saved === true,
      completed: profile.completed === true,
      safetyConcern: typeof profile.safety_concern === 'string' ? profile.safety_concern : '',
    },
    state: {
      setupCompletedAt: str(state.setup_completed_at),
      windowPushOptIn: state.window_push_opt_in === true,
      lastWindowPushAt: str(state.last_window_push_at),
    },
    plan: {
      scope: plan.scope === 'family' ? 'family' : 'solo',
      seed: str(plan.seed) ?? '',
      members: Math.max(1, num(plan.members)),
      signals: {
        soberMoments: signals.sober_moments === true,
        triggers: signals.triggers === true,
        costs: signals.costs === true,
        phrases: signals.phrases === true,
        safetySerious: safetyFirst,
      },
      soberTimes,
    },
    safetyFirst,
    recoveryPhase: str(root.recovery_phase),
    outcomeGate: (gate.outcome === 'yes' || gate.outcome === 'not_yet' || gate.outcome === 'angry')
      && str(gate.local_date) && DATE_PATTERN.test(String(gate.local_date))
      ? { outcome: gate.outcome, localDate: String(gate.local_date), nextWindowDate: str(gate.next_window_date) }
      : null,
    today: {
      movesDone: strings(today.moves_done),
      check: check === 'calm' || check === 'okay' || check === 'rough' ? check : null,
      forecast: recordedLevel === 'low' || recordedLevel === 'possible' || recordedLevel === 'good'
        ? { level: recordedLevel, score: num(recorded.score) }
        : null,
    },
    inputs: {
      latestConsequenceAt: str(inputs.latest_consequence_at),
      warningThisWeek: num(inputs.warning_this_week),
      warningLastWeek: num(inputs.warning_last_week),
      recoveryThisWeek: num(inputs.recovery_this_week),
      recoveryLastWeek: num(inputs.recovery_last_week),
      moveDaysLast7: num(inputs.move_days_7),
    },
    lastAttempt: typeof outcome === 'string' && (INVITATION_OUTCOMES as readonly string[]).includes(outcome)
      && str(attempt.created_at)
      ? {
          outcome: outcome as InvitationOutcome,
          localDate: str(attempt.local_date) ?? '',
          createdAt: str(attempt.created_at) ?? '',
          nextWindowDate: str(attempt.next_window_date),
        }
      : null,
  };
}

/**
 * True when this member is on the safety-first path (her own 'serious'
 * answer). Unknown — no snapshot yet — is treated as safety-first by callers
 * that would otherwise show invitation content.
 */
export function isSafetyFirst(snapshot: EngineSnapshot | null): boolean {
  return !!snapshot && (snapshot.safetyFirst || snapshot.profile.safetyConcern === 'serious');
}

/**
 * Which part of the engine to show. `hasAccess` is the member's
 * canAccessInvitationEngine entitlement (the server enforces it again on
 * every write).
 */
export function engineStage(snapshot: EngineSnapshot, hasAccess: boolean = snapshot.hasAccess): EngineStage {
  // Safety first, even for an unfinished map (setup saves after the safety
  // question) and never paywalled.
  if (isSafetyFirst(snapshot)) return 'safety';
  if (!snapshot.profile.completed) return 'map';
  if (!hasAccess) return 'paywall';
  if (!snapshot.state.setupCompletedAt) return 'finishSetup';
  return 'active';
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** The member-local calendar day, hour and weekday (account timezone). */
export function localClock(now: Date, timezone?: string | null): { date: string; hour: number; weekday: number } {
  if (timezone) {
    try {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hour12: false,
        weekday: 'short',
      }).formatToParts(now).map((part) => [part.type, part.value]));
      const hour = Number(parts.hour) % 24;
      const weekday = WEEKDAYS.indexOf(parts.weekday);
      if (parts.year && parts.month && parts.day && Number.isFinite(hour) && weekday >= 0) {
        return { date: `${parts.year}-${parts.month}-${parts.day}`, hour, weekday };
      }
    } catch {
      // Unknown zone: fall back to the device clock.
    }
  }
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    hour: now.getHours(),
    weekday: now.getDay(),
  };
}

export function engineForecastInput(
  snapshot: EngineSnapshot,
  clock: { hour: number; weekday: number },
  nowMs: number,
): ForecastInput {
  const gate = snapshot.outcomeGate;
  return {
    nowMs,
    localHour: clock.hour,
    localWeekday: clock.weekday,
    latestConsequenceAt: snapshot.inputs.latestConsequenceAt,
    warningThisWeek: snapshot.inputs.warningThisWeek,
    warningLastWeek: snapshot.inputs.warningLastWeek,
    recoveryThisWeek: snapshot.inputs.recoveryThisWeek,
    recoveryLastWeek: snapshot.inputs.recoveryLastWeek,
    soberTimes: snapshot.plan.soberTimes,
    moveDaysLast7: snapshot.inputs.moveDaysLast7,
    todayCheck: snapshot.today.check,
    safetySerious: isSafetyFirst(snapshot),
    localDate: snapshot.localDate,
    lastOutcome: gate?.outcome ?? null,
    lastOutcomeDate: gate?.localDate ?? null,
    nextWindowDate: gate?.nextWindowDate ?? null,
    recoveryPhase: snapshot.recoveryPhase,
  };
}
