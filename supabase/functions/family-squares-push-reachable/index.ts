// Which of the website's Monday-call reminder recipients the app already
// handles (soberhelpline.com → app, MEMBERSHIP_SYNC_SECRET; verify_jwt = false).
//
// POST { emails: string[] } (≤ 1000) → { handled_by_app: string[] }: the
// lower-cased input emails of verified app accounts whose device the app
// confirmed in the last 30 days and who have the Monday call reminder on (the
// same rule the app's reminder dispatcher uses).
// The website skips its reminder emails for those, and fails open (sends them)
// if this call fails.
//
// The answer also carries what members told the app, so the website can
// respect it:
//   reminders_off: string[]: she turned the Monday call reminder off
//   declined:      string[]: she answered "can't make it" for this week's call
// Both are left out (not sent as empty) if that lookup fails, so an older or
// failing lookup can never look like "nobody declined".

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
  const handled = data.filter((e): e is string => typeof e === 'string');

  const preferences = await supabase.rpc('service_family_squares_reminder_preferences', {
    p_emails: emails,
    p_since: familySquaresSyncWindow(new Date()).previousCallEnd.toISOString(),
  });
  if (preferences.error || !Array.isArray(preferences.data)) {
    console.error('family-squares-push-reachable: preferences lookup failed', preferences.error?.code ?? 'invalid_response');
    return json({ handled_by_app: handled });
  }
  const rows = preferences.data as { email?: unknown; reminders_off?: unknown; declined?: unknown }[];
  const emailsWhere = (flag: 'reminders_off' | 'declined') =>
    rows.filter((r) => r?.[flag] === true && typeof r.email === 'string').map((r) => r.email as string);
  return json({ handled_by_app: handled, reminders_off: emailsWhere('reminders_off'), declined: emailsWhere('declined') });
});
