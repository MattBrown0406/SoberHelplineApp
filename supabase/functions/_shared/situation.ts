// Shared situation scoring for notification edge functions.
//
// Mirrors the my_situation() RPC (20261004100300_situation_status_decay.sql:
// _loved_one_status_weight / _loved_one_effective_status) so push copy can
// adapt to a family's readiness band. Keep the weights and thresholds in sync
// with that migration.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type Band = 'calm' | 'watch' | 'elevated' | 'crisis';

/** A loved_ones row (or just its status, for callers without the stage). */
export type LovedOneSignal = {
  status: string | null;
  stage?: string | null;
  stage_changed_at?: string | null;
  status_changed_at?: string | null;
};

const STATUS_WEIGHT: Record<string, number> = {
  stable: 0,
  in_treatment: 0,
  unknown: 5,
  using: 15,
  escalating: 25,
  crisis: 35,
};

const PHASE_WEIGHT: Record<string, number> = {
  active_use: 15,
  return_to_use: 15,
  considering_treatment: 10,
  returning_home: 5,
  in_treatment: 0,
  early_recovery_30: 0,
  early_recovery_90: 0,
  ongoing_recovery: 0,
};

const RECOVERY_PHASES = new Set(['in_treatment', 'returning_home', 'early_recovery_30', 'early_recovery_90', 'ongoing_recovery']);
const ACTIVE_STATUSES = new Set(['using', 'escalating', 'crisis']);
const FADE_MS = 14 * 86400000;

/** Mirrors _invitation_recovery_phase(stage, status). */
export function recoveryPhase(stage: string | null | undefined, status: string | null | undefined): string {
  const current = [
    'active_use', 'considering_treatment', 'in_treatment', 'returning_home',
    'early_recovery_30', 'early_recovery_90', 'ongoing_recovery', 'return_to_use', 'unsure',
  ];
  if (stage && current.includes(stage)) return stage;
  if (stage === 'using') return 'active_use';
  if (stage === 'seeking_help') return 'considering_treatment';
  if (stage === 'recovery') return ACTIVE_STATUSES.has(status ?? '') ? 'return_to_use' : 'early_recovery_30';
  if (status === 'in_treatment') return 'in_treatment';
  if (ACTIVE_STATUSES.has(status ?? '')) return 'active_use';
  return 'unsure';
}

function time(value: string | null | undefined): number | null {
  const at = value ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : null;
}

/** Mirrors _loved_one_effective_status: an escalation that no longer applies stops counting. */
export function effectiveLovedStatus(loved: LovedOneSignal | null, recentWarnings: number, now = Date.now()): string | null {
  const status = loved?.status ?? null;
  if (!loved || status === null || (status !== 'escalating' && status !== 'crisis')) return status;
  const stageAt = time(loved.stage_changed_at);
  const statusAt = time(loved.status_changed_at);
  const phase = loved.stage ? recoveryPhase(loved.stage, status) : null;
  if (phase && RECOVERY_PHASES.has(phase) && stageAt !== null && (statusAt === null || stageAt > statusAt)) {
    return phase === 'in_treatment' ? 'in_treatment' : 'stable';
  }
  if (status === 'escalating' && recentWarnings < 3 && (statusAt === null || statusAt < now - FADE_MS)) return 'using';
  return status;
}

/** Mirrors _loved_one_status_weight. A bare status string keeps the plain status weights. */
export function lovedOneWeight(loved: string | null | LovedOneSignal, recentWarnings = 0, now = Date.now()): number {
  if (loved === null || typeof loved === 'string') return STATUS_WEIGHT[loved ?? 'unknown'] ?? 5;
  const status = effectiveLovedStatus(loved, recentWarnings, now);
  const phase = loved.stage ? recoveryPhase(loved.stage, loved.status) : null;
  if (!phase || phase === 'unsure') return STATUS_WEIGHT[status ?? 'unknown'] ?? 5;
  const escalation = status === 'escalating' ? 25 : status === 'crisis' ? 35 : 0;
  return Math.max(PHASE_WEIGHT[phase] ?? 5, escalation);
}

export function bandForSignals(
  lowMoodDays: number,
  netWarnings: number,
  loved: string | null | LovedOneSignal,
  recentWarnings = 0,
  now = Date.now(),
): Band {
  const score =
    lowMoodDays * 10 +
    Math.max(netWarnings, 0) * 10 +
    lovedOneWeight(loved, recentWarnings, now);
  if (score >= 60) return 'crisis';
  if (score >= 30) return 'elevated';
  if (score >= 10) return 'watch';
  return 'calm';
}

/**
 * Bulk-computes the readiness band for many accounts in three queries.
 * Runs with the service role (RLS bypassed), so it must be called only from
 * trusted edge functions — never exposed to clients.
 */
export async function bandsForAccounts(
  supabase: SupabaseClient,
  accountIds: string[],
): Promise<Map<string, Band>> {
  const bands = new Map<string, Band>();
  if (accountIds.length === 0) return bands;

  const now = Date.now();
  const since7 = new Date(now - 7 * 86400000).toISOString();
  const since14 = new Date(now - 14 * 86400000).toISOString().slice(0, 10);

  const [{ data: checkins }, { data: logs }, { data: loved }] = await Promise.all([
    supabase
      .from('checkins')
      .select('account_id, mood')
      .in('account_id', accountIds)
      .gte('created_at', since7),
    supabase
      .from('tracker_logs')
      .select('account_id, kind')
      .in('account_id', accountIds)
      .gte('week', since14),
    supabase.from('loved_ones')
      .select('account_id, status, stage, stage_changed_at, status_changed_at')
      .in('account_id', accountIds),
  ]);

  const low = new Map<string, number>();
  (checkins ?? []).forEach((c: { account_id: string; mood: number }) => {
    if (c.mood <= 2) low.set(c.account_id, (low.get(c.account_id) ?? 0) + 1);
  });

  const warn = new Map<string, number>();
  const recov = new Map<string, number>();
  (logs ?? []).forEach((l: { account_id: string; kind: string }) => {
    if (l.kind === 'warning') warn.set(l.account_id, (warn.get(l.account_id) ?? 0) + 1);
    else if (l.kind === 'recovery') recov.set(l.account_id, (recov.get(l.account_id) ?? 0) + 1);
  });

  const lovedOnes = new Map<string, LovedOneSignal>();
  (loved ?? []).forEach((r: LovedOneSignal & { account_id: string }) => {
    lovedOnes.set(r.account_id, r);
  });

  for (const id of accountIds) {
    const lowDays = low.get(id) ?? 0;
    const net = (warn.get(id) ?? 0) - (recov.get(id) ?? 0);
    bands.set(id, bandForSignals(lowDays, net, lovedOnes.get(id) ?? null, warn.get(id) ?? 0));
  }
  return bands;
}
