// notify-family-backup — client-invoked after a member opts in to share wavering.
// Copy is supportive, never shaming: "{name} could use backup on a wall."
// Requires the signed-in user's JWT. Never accepts a name from the request body.

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return json({ error: 'Supabase env missing' }, 500);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: userData, error: userError } = await admin.auth.getUser(
    authHeader.replace('Bearer ', ''),
  );
  if (userError || !userData?.user) return json({ error: 'unauthorized' }, 401);

  let waveringEventId = '';
  try {
    const body = await req.json();
    waveringEventId = typeof body?.wavering_event_id === 'string' ? body.wavering_event_id : '';
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  if (!waveringEventId) return json({ error: 'invalid_body' }, 400);

  const { data: account } = await admin
    .from('accounts')
    .select('id, first_name, locale')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (!account) return json({ error: 'no account' }, 404);

  const { data: event } = await admin
    .from('wavering_events')
    .select('id, shared_wall_id, account_id, shared_with_family, created_at, notification_claimed_at')
    .eq('id', waveringEventId)
    .maybeSingle();
  if (!event || event.account_id !== account.id) return json({ error: 'not_found' }, 404);
  if (!event.shared_with_family || event.notification_claimed_at) return json({ ok: true, sent: 0 });
  if (Date.now() - new Date(event.created_at).getTime() > 10 * 60 * 1000) {
    return json({ ok: true, sent: 0 });
  }

  // Consent is represented by the latest event for this member and wall. A
  // newer private event revokes an earlier opt-in before it can be replayed.
  const { data: latest } = await admin
    .from('wavering_events')
    .select('id, shared_with_family')
    .eq('shared_wall_id', event.shared_wall_id)
    .eq('account_id', account.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest || latest.id !== event.id || !latest.shared_with_family) {
    return json({ ok: true, sent: 0 });
  }

  const { data: claimed } = await admin
    .from('wavering_events')
    .update({ notification_claimed_at: new Date().toISOString() })
    .eq('id', event.id)
    .is('notification_claimed_at', null)
    .select('shared_wall_id')
    .maybeSingle();
  if (!claimed) return json({ ok: true, sent: 0 });

  const { data: wall } = await admin
    .from('shared_walls')
    .select('id, family_space_id')
    .eq('id', event.shared_wall_id)
    .maybeSingle();
  if (!wall) return json({ error: 'not_found' }, 404);

  const { data: membership } = await admin
    .from('family_members')
    .select('id')
    .eq('family_space_id', wall.family_space_id)
    .eq('account_id', account.id)
    .maybeSingle();
  if (!membership) return json({ error: 'forbidden' }, 403);


  const { data: members } = await admin
    .from('family_members')
    .select('account_id')
    .eq('family_space_id', wall.family_space_id);

  const ids = (members ?? []).map((row) => row.account_id).filter((id) => id !== account.id);
  if (ids.length === 0) return json({ ok: true, sent: 0 });

  const { data: targets } = await admin
    .from('accounts')
    .select('id, push_token, locale')
    .in('id', ids);

  const name = (account.first_name ?? '').trim() || 'A family member';
  let sent = 0;
  for (const target of targets ?? []) {
    if (!target.push_token) continue;
    const es = String(target.locale ?? '').startsWith('es');
    const title = es ? 'Espacio familiar' : 'Family space';
    const body = es
      ? `${name} podría usar apoyo en un muro hoy.`
      : `${name} could use backup on a wall today.`;
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to: target.push_token,
        title,
        body,
        sound: 'default',
        data: { kind: 'family_backup' },
      }),
    });
    if (res.ok) sent += 1;
  }

  return json({ ok: true, sent });
});
