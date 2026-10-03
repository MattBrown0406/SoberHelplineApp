// App memberships for soberhelpline.com (website → app, MEMBERSHIP_SYNC_SECRET;
// verify_jwt = false). Replaces the website reading this database directly.
//
// POST { cursor?: string | null, limit?: number (≤ 1000) }
//   → { members: [{ email, tier: 'essential'|'premier'|'org', expires_at }], next_cursor }
// Every verified app account with active app-origin paid access (never access
// the website itself granted), one row per account, in a stable order; pass
// next_cursor back until it is null.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireSyncSecret } from '../_shared/sync-secret.ts';
import { exportPage, parseExportRequest } from '../_shared/website-bridge.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  const authError = requireSyncSecret(req);
  if (authError) return authError;

  const text = await req.text().catch(() => '');
  let body: unknown = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: 'invalid json' }, 400);
    }
  }
  const page = parseExportRequest(body);
  if (!page) return json({ error: 'cursor must be a cursor from a previous page; limit a number' }, 400);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await supabase.rpc('service_membership_export', {
    p_after: page.cursor,
    p_limit: page.limit,
  });
  if (error || !Array.isArray(data)) {
    console.error('membership-export: lookup failed', error?.code ?? 'invalid_response');
    return json({ error: 'unavailable' }, 503);
  }
  return json(exportPage(data, page.limit));
});
