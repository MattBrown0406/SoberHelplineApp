// delete-website-account — the app calls this while a member is deleting
// their account, before the app account itself is removed, so their
// soberhelpline.com account (same verified email) is deleted too and any
// website membership billed through PayPal is cancelled.
//
// The email comes from the caller's verified token, never from the request
// body. The website is asked server to server with the shared
// MEMBERSHIP_SYNC_SECRET. Never log the email.
//
// Answers { ok, result }:
//   ok true  — deleted | not_found | protected | no_verified_email | not_installed
//              (the app may go on and delete its own account)
//   ok false — the website could not finish (for example PayPal refused the
//              cancellation). The app stops so nothing is half done, and the
//              member can try again.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { normalizeEmail, websiteFunctionUrl } from '../_shared/website-bridge.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const MAY_CONTINUE = new Set(['deleted', 'not_found', 'protected']);

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
  if (!email) return json({ ok: true, result: 'no_verified_email' });

  const secret = Deno.env.get('MEMBERSHIP_SYNC_SECRET');
  if (!secret) {
    console.error('[delete-website-account] MEMBERSHIP_SYNC_SECRET is not configured');
    return json({ ok: false, result: 'not_configured' });
  }

  try {
    const response = await fetch(websiteFunctionUrl('app-account-deleted', Deno.env.get('WEBSITE_FUNCTIONS_URL')), {
      // The website may need to cancel a PayPal membership first.
      signal: AbortSignal.timeout(25_000),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-membership-sync-secret': secret },
      body: JSON.stringify({ email }),
    });
    // The website has not published its side yet: nothing there to wait for.
    if (response.status === 404) {
      await response.body?.cancel();
      return json({ ok: true, result: 'not_installed' });
    }
    const answer = await response.json().catch(() => null) as { result?: unknown } | null;
    const result = typeof answer?.result === 'string' ? answer.result : 'error';
    if (response.ok && MAY_CONTINUE.has(result)) return json({ ok: true, result });
    console.error('[delete-website-account] website could not finish', response.status, result);
    return json({ ok: false, result: MAY_CONTINUE.has(result) ? 'error' : result });
  } catch (error) {
    console.error('[delete-website-account] unreachable', error instanceof Error ? error.name : 'unknown');
    return json({ ok: false, result: 'unreachable' });
  }
});
