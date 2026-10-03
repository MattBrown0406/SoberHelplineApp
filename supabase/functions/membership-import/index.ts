// Website memberships into the app (website → app, MEMBERSHIP_SYNC_SECRET;
// verify_jwt = false). Replaces the website writing this database directly.
//
// POST { members: [{ email, expires_at }], complete: true, dry_run?, allow_mass_revoke? }
//   → { ok, matched, granted, updated, revoked, unmatched, revocation_blocked, ... }
// `members` is the COMPLETE list of current website members (≤ 5000, one call).
// Each matched verified app account keeps one website-granted Essential
// entitlement; website grants for accounts no longer listed are expired, unless
// that would revoke more than 25% (and more than 10) of them — then nothing is
// revoked and revocation_blocked is reported until a run with
// allow_mass_revoke. dry_run reports without changing anything.
// The plan and writes are one transaction: service_membership_import.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { requireSyncSecret } from '../_shared/sync-secret.ts';
import { parseImportRequest } from '../_shared/website-bridge.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  const authError = requireSyncSecret(req);
  if (authError) return authError;

  const parsed = parseImportRequest(await req.json().catch(() => null));
  if (typeof parsed === 'string') return json({ ok: false, error: parsed }, 400);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data, error } = await supabase.rpc('service_membership_import', {
    p_members: parsed.members,
    p_dry_run: parsed.dryRun,
    p_allow_mass_revoke: parsed.allowMassRevoke,
  });
  if (error || !data || typeof data !== 'object') {
    console.error('membership-import: failed', error?.code ?? 'invalid_response');
    return json({ ok: false, error: 'unavailable' }, 503);
  }
  const result = data as Record<string, unknown>;
  // Counts only — never the emails.
  console.log('membership-import', JSON.stringify(result));
  if (result.revocation_blocked === true) {
    console.error('membership-import: revocation blocked by the mass-revocation guard', result.revoke_candidates);
  }
  return json({ ok: true, ...result });
});
