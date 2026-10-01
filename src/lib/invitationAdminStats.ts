/** Parse admin_invitation_stats() JSON into a typed shape (pure; admin screen only). */

export type InvitationPeriodStats = {
  attempts: number;
  yes: number;
  movesDone: number;
  newFamilies: number;
  activeFamilies: number;
};

export type AdminInvitationStats = {
  familiesUsing: number;
  profilesMapped: number;
  windowPushOptIns: number;
  attempts: number;
  asks: number;
  outcomes: { yes: number; notYet: number; angry: number; didntGetToIt: number };
  /** Share of real invitations (not "didn't get to it") that ended in yes, 0–1. */
  yesRate: number | null;
  familiesWithYes: number;
  medianDaysToYes: number | null;
  movesDone: number;
  last30: InvitationPeriodStats;
  prior30: InvitationPeriodStats;
  weekly: Array<{ weekStart: string; attempts: number; yes: number; movesDone: number }>;
  recentYes: Array<{ id: string; createdAt: string; name: string; email: string | null }>;
};

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
}

function count(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}

function period(value: unknown): InvitationPeriodStats {
  const p = obj(value);
  return {
    attempts: count(p.attempts),
    yes: count(p.yes),
    movesDone: count(p.moves_done),
    newFamilies: count(p.new_families),
    activeFamilies: count(p.active_families),
  };
}

export function parseAdminInvitationStats(raw: unknown): AdminInvitationStats | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Json;
  if (!('families_using' in r)) return null;
  const outcomes = obj(r.outcomes);
  return {
    familiesUsing: count(r.families_using),
    profilesMapped: count(r.profiles_mapped),
    windowPushOptIns: count(r.window_push_opt_ins),
    attempts: count(r.attempts),
    asks: count(r.asks),
    outcomes: {
      yes: count(outcomes.yes),
      notYet: count(outcomes.not_yet),
      angry: count(outcomes.angry),
      didntGetToIt: count(outcomes.didnt_get_to_it),
    },
    yesRate: nullableNumber(r.yes_rate),
    familiesWithYes: count(r.families_with_yes),
    medianDaysToYes: nullableNumber(r.median_days_to_yes),
    movesDone: count(r.moves_done),
    last30: period(r.last_30_days),
    prior30: period(r.prior_30_days),
    weekly: (Array.isArray(r.weekly) ? r.weekly : []).flatMap((week) => {
      const w = obj(week);
      return typeof w.week_start === 'string'
        ? [{ weekStart: w.week_start, attempts: count(w.attempts), yes: count(w.yes), movesDone: count(w.moves_done) }]
        : [];
    }),
    recentYes: (Array.isArray(r.recent_yes) ? r.recent_yes : []).flatMap((item) => {
      const y = obj(item);
      if (typeof y.id !== 'string' || typeof y.created_at !== 'string') return [];
      const name = [y.first_name, y.last_name].filter((part): part is string => typeof part === 'string' && !!part.trim()).join(' ');
      return [{
        id: y.id,
        createdAt: y.created_at,
        name,
        email: typeof y.email === 'string' ? y.email : null,
      }];
    }),
  };
}
