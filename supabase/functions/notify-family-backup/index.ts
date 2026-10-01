// Client-invoked only for a persisted, explicitly shared wavering event.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { familyBackupData } from '../_shared/push-data.ts';
import {
  checked,
  dayDeadline,
  deliverLegacy,
  familyBoundary,
  recordDelivery,
  remaining,
  tally,
} from '../_shared/legacy-sender-boundary.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ error: 'Supabase env missing' }, 500);
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);
  const admin = createClient(url, key);
  try {
    const service = authHeader === `Bearer ${key}`;
    const { data: userData, error: userError } = service
      ? { data: null, error: null }
      : await admin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (!service && (userError || !userData?.user)) return json({ error: 'unauthorized' }, 401);
    let waveringEventId = '';
    try {
      const body = await req.json();
      waveringEventId = typeof body?.wavering_event_id === 'string' ? body.wavering_event_id : '';
    } catch {
      return json({ error: 'invalid_body' }, 400);
    }
    if (!waveringEventId) return json({ error: 'invalid_body' }, 400);
    // Only the exact service credential may retry a persisted source event.
    // It never supplies an arbitrary owner or notification payload.
    const retryEvent = service ? await checked(admin.from('wavering_events')
      .select('account_id').eq('id', waveringEventId).maybeSingle()) : null;
    if (service && !retryEvent) return json({ error: 'not_found' }, 404);
    const account = await checked(
      admin.from('accounts').select('id, user_id, first_name, locale, timezone').eq(
        service ? 'id' : 'user_id',
        service ? retryEvent!.account_id : userData!.user!.id,
      ).maybeSingle(),
    );
    if (!account) return json({ error: 'no account' }, 404);
    const event = await checked(
      admin.from('wavering_events')
        .select(
          'id, shared_wall_id, account_id, shared_with_family, created_at, notification_claimed_at',
        ).eq('id', waveringEventId).maybeSingle(),
    );
    if (!event || event.account_id !== account.id) return json({ error: 'not_found' }, 404);
    if (!event.shared_with_family || event.notification_claimed_at) {
      return json({ ok: true, sent: 0 });
    }
    const created = Date.parse(event.created_at);
    if (!Number.isFinite(created)) return json({ ok: true, sent: 0 });
    const deadline = Math.min(created + 10 * 60000, dayDeadline(created, account.timezone));
    if (!remaining(deadline) || created > Date.now()) return json({ ok: true, sent: 0 });
    const wall = await checked(
      admin.from('shared_walls').select('id, family_space_id').eq('id', event.shared_wall_id)
        .maybeSingle(),
    );
    if (!wall) return json({ error: 'not_found' }, 404);
    const membership = async (id: string) =>
      await checked(
        admin.from('family_members').select('id')
          .eq('family_space_id', wall.family_space_id).eq('account_id', id).maybeSingle(),
      );
    if (!await membership(account.id)) return json({ error: 'forbidden' }, 403);
    const latest = async () =>
      await checked(
        admin.from('wavering_events')
          .select('id, account_id, shared_wall_id, shared_with_family, created_at')
          .eq('shared_wall_id', event.shared_wall_id).eq('account_id', account.id)
          .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1)
          .maybeSingle(),
      );
    const current = await latest();
    if (!current || current.id !== event.id || !current.shared_with_family) {
      return json({ ok: true, sent: 0 });
    }
    const members = await checked(
      admin.from('family_members').select('account_id').eq('family_space_id', wall.family_space_id),
    );
    const ids = (members ?? []).map((row) => row.account_id).filter((id) => id !== account.id);
    if (!ids.length) return json({ ok: true, sent: 0 });
    const targets = await checked(admin.from('accounts').select('id').in('id', ids));
    const counts = tally();
    for (const candidate of targets ?? []) {
      if (!remaining(deadline)) {
        counts.skipped++;
        continue;
      }
      let lease: string | null = null;
      let accepted = false;
      try {
        lease = await checked(admin.rpc('claim_push_recipient', {
          p_kind: 'family_backup', p_event_key: event.id, p_account_id: candidate.id,
          p_expires_at: new Date(deadline).toISOString(),
        }));
        if (!lease) { counts.skipped++; continue; }
        // A single final snapshot closes races *between* source, consent,
        // membership and device reads as well as between sequential sends.
        const snapshot = await familyBoundary(
          admin,
          account.id,
          event.shared_wall_id,
          candidate.id,
          event.created_at,
        );
        const source = snapshot?.accounts;
        const currentWall = snapshot?.shared_walls;
        const members = currentWall?.family_spaces?.family_members ?? [];
        const target = members.find((m) => m.account_id === candidate.id)?.accounts;
        if (
          !snapshot || !source || !currentWall || !target || snapshot.id !== event.id ||
          !snapshot.shared_with_family ||
          source?.id !== account.id || source.user_id !== account.user_id ||
          currentWall?.id !== event.shared_wall_id ||
          currentWall.family_space_id !== wall.family_space_id ||
          !members.some((m) => m.account_id === account.id && m.accounts?.id === account.id) ||
          target?.id !== candidate.id || !target.push_token
        ) {
          counts.skipped++;
          continue;
        }
        const es = String(target.locale ?? '').startsWith('es');
        const name = String(source.first_name ?? '').trim() ||
          (es ? 'Un familiar' : 'A family member');
        const result = await deliverLegacy({
            to: target.push_token,
            title: es ? 'Espacio familiar' : 'Family space',
            body: es
              ? `${name} podría usar apoyo en un muro hoy.`
              : `${name} could use backup on a wall today.`,
            sound: 'default',
            data: familyBackupData(waveringEventId),
          }, deadline);
        accepted = result.ok;
        recordDelivery(counts, result);
      } catch {
        counts.failed++;
        counts.retryable++;
      } finally {
        if (lease) {
          // Do not release an accepted ticket as a failed attempt if the ACK
          // write fails. Leave its lease intact and surface the uncertainty.
          try {
            const finished = await checked(admin.rpc('finish_push_recipient', {
              p_kind: 'family_backup', p_event_key: event.id, p_account_id: candidate.id,
              p_processing_token: lease, p_accepted: accepted,
            }));
            if (!finished) throw new Error('lease_lost');
          } catch { counts.failed++; counts.retryable++; }
        }
      }
    }
    return json(
      { ok: counts.failed === 0, ...counts },
      counts.failed ? 502 : 200,
    );
  } catch {
    return json({ error: 'lookup_failed', retryable: true }, 500);
  }
});
