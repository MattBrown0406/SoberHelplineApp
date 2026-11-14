// website-coaching-sessions — the app calls this to show a member the
// coaching sessions they booked on soberhelpline.com in "My sessions".
//
// The email comes from the caller's verified token, never from the request
// body. The website is asked server to server with the shared
// MEMBERSHIP_SYNC_SECRET, and its answer is checked again before it is
// returned (website-coaching.ts). Nothing is stored. Never log the email or a
// join link.
//
// Answers { ok, sessions }. ok false means the website could not be asked;
// the app then simply shows no website sessions.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { normalizeEmail, websiteFunctionUrl } from '../_shared/website-bridge.ts';
import { parseWebsiteSessions } from '../_shared/website-coaching.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'not_authenticated' }, 401);

  // Only a verified email identifies the same person on the website.
  const email = user.email_confirmed_at ? normalizeEmail(user.email) : null;
  if (!email) return json({ ok: true, sessions: [] });

  const secret = Deno.env.get('MEMBERSHIP_SYNC_SECRET');
  if (!secret) {
    console.error('[website-coaching-sessions] MEMBERSHIP_SYNC_SECRET is not configured');
    return json({ ok: false, sessions: [] });
  }

  try {
    const response = await fetch(websiteFunctionUrl('app-coaching-bookings', Deno.env.get('WEBSITE_FUNCTIONS_URL')), {
      signal: AbortSignal.timeout(10_000),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-membership-sync-secret': secret },
      body: JSON.stringify({ email }),
    });
    // The website has not published its side yet: no website sessions to show.
    if (response.status === 404) {
      await response.body?.cancel();
      return json({ ok: true, sessions: [] });
    }
    if (!response.ok) {
      await response.body?.cancel();
      console.error('[website-coaching-sessions] website answered', response.status);
      return json({ ok: false, sessions: [] });
    }
    const sessions = parseWebsiteSessions(await response.json().catch(() => null));
    console.log('[website-coaching-sessions] returned', sessions.length);
    return json({ ok: true, sessions });
  } catch (error) {
    console.error('[website-coaching-sessions] unreachable', error instanceof Error ? error.name : 'unknown');
    return json({ ok: false, sessions: [] });
  }
});
