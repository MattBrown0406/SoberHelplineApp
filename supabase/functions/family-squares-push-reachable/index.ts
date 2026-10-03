// Which of the website's Monday-call reminder recipients the app already
// handles (soberhelpline.com → app, MEMBERSHIP_SYNC_SECRET; verify_jwt = false).
//
// POST { emails: string[] } (≤ 1000) → { handled_by_app: string[] }: the
// lower-cased input emails of verified app accounts with a push token and
// either the call reminder on or a going/declined RSVP for this week's call.
// The website skips its reminder emails for those, and fails open (sends them)
// if this call fails.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireSyncSecret } from '../_shared/sync-secret.ts';
import { familySquaresSyncWindow } from '../_shared/family-squares-time.ts';
import { MAX_REACHABLE_EMAILS, parseEmailBatch } from '../_shared/website-bridge.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  const authError = requireSyncSecret(req);
  if (authError) return authError;

  const emails = parseEmailBatch(await req.json().catch(() => null));
  if (!emails) return json({ error: `emails must be an array of at most ${MAX_REACHABLE_EMAILS} strings` }, 400);
  if (emails.length === 0) return json({ handled_by_app: [] });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await supabase.rpc('service_family_squares_push_reachable', {
    p_emails: emails,
    p_since: familySquaresSyncWindow(new Date()).previousCallEnd.toISOString(),
  });
  if (error || !Array.isArray(data)) {
    console.error('family-squares-push-reachable: lookup failed', error?.code ?? 'invalid_response');
    return json({ error: 'unavailable' }, 503);
  }
  return json({ handled_by_app: data.filter((e): e is string => typeof e === 'string') });
});
