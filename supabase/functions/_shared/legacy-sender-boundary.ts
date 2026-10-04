// Provider-boundary guards for legacy (non-outbox) senders only.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { type Band, bandForSignals, type LovedOneSignal } from './situation.ts';

export async function checked<T>(query: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error('lookup_failed');
  return data;
}

export function zone(timezone: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'America/New_York' })
      .resolvedOptions().timeZone;
  } catch {
    return 'America/New_York';
  }
}
export function localDay(now: number, timezone: string | null): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now));
  const p = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function localHour(now: number, timezone: string | null): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone(timezone),
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date(now)),
  );
}
/** Absolute next midnight, including DST days. Never rebuilt after async IO. */
export function dayDeadline(now: number, timezone: string | null): number {
  const day = localDay(now, timezone);
  let lo = Math.floor(now / 1000), hi = lo + 27 * 3600;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDay(mid * 1000, timezone) === day) lo = mid;
    else hi = mid;
  }
  return hi * 1000;
}
/** The scheduled 19:00 Pacific call, not a rolling 15-minute retry window. */
export function sessionDeadline(now: number): number {
  const midnight = dayDeadline(now, 'America/Los_Angeles');
  // Pacific DST transitions occur before 19:00, so the final five hours are fixed.
  return midnight - 5 * 3600000;
}
export function remaining(deadline: number): number {
  return Number.isFinite(deadline) ? Math.max(0, Math.floor((deadline - Date.now()) / 1000)) : 0;
}
/** All daily eligibility/copy inputs and the destination share one snapshot. */
export async function freshDailyAccount(db: SupabaseClient, id: string, day?: string) {
  const since7 = new Date(Date.now() - 7 * 86400000).toISOString();
  const since14 = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  let query = db.from('accounts').select(`id, push_token, locale, timezone, daily_push_opt_in,
    recent_checkins:checkins(mood), today_checkins:checkins(checkin_date),
    tracker_logs(kind), loved_ones(status, stage, stage_changed_at, status_changed_at)`)
    .eq('id', id).gte('recent_checkins.created_at', since7).gte('tracker_logs.week', since14);
  // Morning notes do not depend on today's completion; avoid fetching history.
  query = query.eq('today_checkins.checkin_date', day ?? '0001-01-01');
  const a = await checked(query.maybeSingle());
  if (!a) return null;
  // loved_ones.account_id is UNIQUE: PostgREST embeds an object, not an array.
  const loved = a.loved_ones as unknown as LovedOneSignal | null;
  const band: Band = bandForSignals(
    (a.recent_checkins ?? []).filter((c) => c.mood <= 2).length,
    (a.tracker_logs ?? []).reduce(
      (n, l) => n + (l.kind === 'warning' ? 1 : l.kind === 'recovery' ? -1 : 0),
      0,
    ),
    loved ?? null,
    (a.tracker_logs ?? []).filter((l) => l.kind === 'warning').length,
  );
  return { ...a, band, checkedIn: !!a.today_checkins?.length };
}
/** Latest event (including private events), both memberships and token together.
 * Do NOT filter shared_with_family=true in SQL: that hides newer withdrawals.
 */
export async function familyBoundary(
  db: SupabaseClient,
  sourceId: string,
  wallId: string,
  targetId: string,
  createdAt: string,
) {
  const rows = await checked(
    db.from('wavering_events').select(`id, shared_with_family, created_at,
    accounts!inner(id, user_id, first_name),
    shared_walls!inner(id, family_space_id,
      family_spaces!inner(family_members(account_id, accounts!inner(id, push_token, locale))))`)
      .eq('account_id', sourceId).eq('shared_wall_id', wallId).gte('created_at', createdAt)
      .in('shared_walls.family_spaces.family_members.account_id', [sourceId, targetId])
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(2),
  );
  type Snapshot = {
    id: string;
    shared_with_family: boolean;
    created_at: string;
    accounts: { id: string; user_id: string; first_name: string | null };
    shared_walls: {
      id: string;
      family_space_id: string;
      family_spaces: {
        family_members: {
          account_id: string;
          accounts: { id: string; push_token: string | null; locale: string | null };
        }[];
      };
    };
  };
  // Equal created_at values have no causal UUID ordering. Any other event at
  // or after this source supersedes it conservatively, including private ties.
  return (rows?.length === 1 ? rows[0] : null) as unknown as Snapshot | null;
}
export type Delivery = { ok: boolean; skipped?: boolean; error?: string; retryable?: boolean };
/** One recipient per boundary: no earlier cached recipients await another send. */
export async function deliverLegacy(
  message: Record<string, unknown>,
  deadline?: number,
): Promise<Delivery> {
  const ttl = deadline === undefined ? undefined : remaining(deadline);
  if (ttl === 0) return { ok: false, skipped: true, error: 'expired', retryable: false };
  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        ...message,
        // Expo ttl takes precedence over expiration. Send ONLY the absolute
        // expiration so network/queue delay cannot restart a relative lifetime.
        ...(deadline === undefined ? {} : { expiration: Math.floor(deadline / 1000) }),
      }),
    });
    if (!response.ok) {
      return {
        ok: false,
        error: `provider_http_${response.status}`,
        retryable: response.status === 429 || response.status >= 500,
      };
    }
    const body = await response.json();
    const ticket = Array.isArray(body?.data)
      ? (body.data.length === 1 ? body.data[0] : null)
      : body?.data;
    if (ticket?.status === 'ok' && typeof ticket.id === 'string' && ticket.id.trim()) {
      return { ok: true };
    }
    const code = ticket?.details?.error;
    if (ticket?.status === 'error' && typeof code === 'string') {
      return {
        ok: false,
        error: code,
        retryable: ![
          'DeviceNotRegistered',
          'MessageTooBig',
          'InvalidCredentials',
          'MismatchSenderId',
        ].includes(code),
      };
    }
    return { ok: false, error: 'provider_response_invalid', retryable: true };
  } catch {
    return { ok: false, error: 'provider_unavailable', retryable: true };
  }
}
export function tally() {
  return { sent: 0, failed: 0, skipped: 0, retryable: 0 };
}
export function recordDelivery(counts: ReturnType<typeof tally>, result: Delivery) {
  if (result.ok) counts.sent++;
  else if (result.skipped) counts.skipped++;
  else {
    counts.failed++;
    if (result.retryable) counts.retryable++;
  }
}
