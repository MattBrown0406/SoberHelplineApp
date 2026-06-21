// Shared situation scoring for notification edge functions.
//
// Mirrors the my_situation() RPC (20260620120000_p0_loved_ones_and_situation.sql)
// so push copy can adapt to a family's readiness band. Keep the weights and
// thresholds in sync with that migration.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export type Band = 'calm' | 'watch' | 'elevated' | 'crisis';

const STATUS_WEIGHT: Record<string, number> = {
  stable: 0,
  in_treatment: 0,
  unknown: 5,
  using: 15,
  escalating: 25,
  crisis: 35,
};

export function bandForSignals(
  lowMoodDays: number,
  netWarnings: number,
  lovedStatus: string | null,
): Band {
  const score =
    lowMoodDays * 10 +
    Math.max(netWarnings, 0) * 10 +
    (STATUS_WEIGHT[lovedStatus ?? 'unknown'] ?? 5);
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
    supabase.from('loved_ones').select('account_id, status').in('account_id', accountIds),
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

  const status = new Map<string, string>();
  (loved ?? []).forEach((r: { account_id: string; status: string }) => {
    status.set(r.account_id, r.status);
  });

  for (const id of accountIds) {
    const lowDays = low.get(id) ?? 0;
    const net = (warn.get(id) ?? 0) - (recov.get(id) ?? 0);
    bands.set(id, bandForSignals(lowDays, net, status.get(id) ?? null));
  }
  return bands;
}
