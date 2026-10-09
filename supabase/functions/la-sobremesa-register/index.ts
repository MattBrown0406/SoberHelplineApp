// la-sobremesa-register — reserves the signed-in member's place in La Sobremesa
// (AyudaSobria.com's Spanish Monday call, 8:00 PM Pacific) and returns their
// personal Zoom link.
//
// The email comes from the verified app session (never the request body).
// AyudaSobria registers it with Zoom, emails the link and calendar invite, and
// answers server to server (AYUDA_SYNC_SECRET). The link is kept in
// session_join_links (readable only by its owner) and the RSVP is set to going.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { AYUDA_APP_REGISTER_URL, parseAyudaRegistration } from '../_shared/la-sobremesa.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const secret = Deno.env.get('AYUDA_SYNC_SECRET') ?? '';
  if (!secret) return json({ error: 'not_configured' }, 503);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData, error: userError } = jwt ? await admin.auth.getUser(jwt) : { data: null, error: true };
  const user = userData?.user;
  if (userError || !user?.email) return json({ error: 'unauthorized' }, 401);
  if (!user.email_confirmed_at) return json({ error: 'email_unverified' }, 403);

  const { data: account } = await admin
    .from('accounts')
    .select('id, first_name, last_name')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!account) return json({ error: 'no_account' }, 404);

  const { data: sessionId, error: sessionError } = await admin.rpc('la_sobremesa_session_id');
  if (sessionError || typeof sessionId !== 'string') return json({ error: 'unavailable' }, 503);

  const fullName = [account.first_name, account.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();

  let registration;
  try {
    const resp = await fetch(AYUDA_APP_REGISTER_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/json', 'x-membership-sync-secret': secret },
      body: JSON.stringify({ email: user.email.trim().toLowerCase(), fullName: fullName || 'Familia' }),
    });
    registration = parseAyudaRegistration(resp.status, await resp.json().catch(() => null));
  } catch {
    registration = { ok: false as const, status: 'error' as const };
  }
  if (!registration.ok) {
    return json({ error: registration.status }, registration.status === 'not_available' ? 404 : 502);
  }
  // Right after a call AyudaSobria may still hand back that call's link; it's no use now.
  if (Date.parse(registration.startsAt) + 75 * 60_000 <= Date.now()) {
    return json({ error: 'not_available' }, 404);
  }

  const { error: linkError } = await admin.from('session_join_links').upsert({
    session_id: sessionId,
    account_id: account.id,
    join_url: registration.joinUrl,
    starts_at: registration.startsAt,
    created_at: new Date().toISOString(),
  }, { onConflict: 'session_id,account_id' });
  if (linkError) return json({ error: 'unavailable' }, 503);

  const { error: rsvpError } = await admin.from('session_rsvps').upsert({
    session_id: sessionId,
    account_id: account.id,
    status: 'going',
  }, { onConflict: 'session_id,account_id' });
  if (rsvpError) return json({ error: 'unavailable' }, 503);

  return json({ joinUrl: registration.joinUrl, startsAt: registration.startsAt });
});
