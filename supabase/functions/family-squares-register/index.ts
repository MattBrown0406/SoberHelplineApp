// Authenticated, identity-derived reconciliation; never trust client email/date/RSVP.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { familySquaresSyncWindow } from '../_shared/family-squares-time.ts';
import { websiteFunctionUrl } from '../_shared/website-bridge.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const jwt = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1];
    if (!jwt) return json({ ok: false, error: 'unauthorized' }, 401);
    const { data, error } = await admin.auth.getUser(jwt);
    const user = data?.user;
    if (error || !user?.email || user.is_anonymous) return json({ ok: false, error: 'unauthorized' }, 401);
    if (!user.email_confirmed_at) return json({ ok: false, error: 'email_unverified' }, 403);
    // No parameters accepted: the public caller cannot enumerate other emails or dates.
    const body = await req.json().catch(() => null);
    if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length) {
      return json({ ok: false, error: 'invalid_request' }, 400);
    }
    const secret = Deno.env.get('MEMBERSHIP_SYNC_SECRET');
    if (!secret) return json({ ok: false, error: 'unavailable' }, 503);
    const { data: account, error: accountError } = await admin.from('accounts')
      .select('id, first_name, last_name').eq('user_id', user.id).maybeSingle();
    if (accountError || !account) return json({ ok: false, error: 'unavailable' }, 503);
    const { data: sessionId, error: sessionError } = await admin.rpc('family_squares_session_id');
    if (sessionError || typeof sessionId !== 'string' || !sessionId) return json({ ok: false, error: 'unavailable' }, 503);
    const now = new Date();
    const { meetingDate } = familySquaresSyncWindow(now);
    const name = [account.first_name, account.last_name].filter((p) => typeof p === 'string' && p.trim()).join(' ').trim() || 'Family';
    const response = await fetch(websiteFunctionUrl('app-family-squares-sync', Deno.env.get('WEBSITE_FUNCTIONS_URL')), {
      method: 'POST', signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/json', 'x-membership-sync-secret': secret },
      body: JSON.stringify({ action: 'ensure-registration', meeting_date: meetingDate, attendee: { email: user.email.trim().toLowerCase(), name } }),
    });
    const registration = await response.json().catch(() => null);
    if (!response.ok || registration?.ok !== true || typeof registration.already_registered !== 'boolean'
      || registration.meeting_date !== meetingDate) return json({ ok: false, error: 'website_unavailable' }, 502);
    // Crossing the call-end boundary must not stamp the previous occurrence as current.
    if (familySquaresSyncWindow(new Date()).meetingDate !== meetingDate) return json({ ok: false, error: 'retry' }, 409);
    // One composite-PK row; occurrence + timestamp advance together for the existing batch bridge.
    const { error: saveError } = await admin.from('session_rsvps').upsert({
      session_id: sessionId, account_id: account.id, status: 'going',
      family_squares_meeting_date: meetingDate, created_at: now.toISOString(),
    }, { onConflict: 'session_id,account_id' });
    if (saveError) return json({ ok: false, error: 'unavailable' }, 503);
    return json({ ok: true, already_registered: registration.already_registered, meeting_date: meetingDate });
  } catch {
    // No PII, JWT, provider payloads or secrets in logs/responses.
    return json({ ok: false, error: 'unavailable' }, 503);
  }
});
