// website-account-deleted — soberhelpline.com calls this when a member deletes
// their website account, so the app account with the same verified email is
// deleted too ("delete my account" means everywhere).
//
// Server to server only: the shared MEMBERSHIP_SYNC_SECRET in the
// x-membership-sync-secret header is the gate (verify_jwt = false). The
// AyudaSobria secret is NOT accepted here.
//
// Safety: only an account whose VERIFIED login email matches is touched, and
// staff accounts (the owner's admin emails, active video staff) are never
// deleted this way; the website is told "protected" and the owner handles it.
// Never log the email.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { purgeAccountFiles } from '../_shared/account-files.ts';
import { requireSyncSecret } from '../_shared/sync-secret.ts';
import { normalizeEmail } from '../_shared/website-bridge.ts';

const headers = { 'Content-Type': 'application/json' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req) => {
  const denied = requireSyncSecret(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, result: 'bad_request' }, 400);
  }
  const email = normalizeEmail((body as { email?: unknown } | null)?.email);
  if (!email) return json({ ok: false, result: 'bad_request' }, 400);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: targets, error: targetError } = await admin.rpc('service_account_deletion_target', { p_email: email });
    if (targetError) throw new Error(`target lookup failed: ${targetError.code ?? 'unknown'}`);
    const target = (targets as { user_id: string; account_id: string | null; protected: boolean }[] | null)?.[0];
    if (!target) return json({ ok: true, result: 'not_found' });
    if (target.protected) {
      console.log('[website-account-deleted] protected account left in place');
      return json({ ok: true, result: 'protected' });
    }

    // Stored photos do not cascade with the account; remove them first so
    // nothing is left behind if the deletion goes through.
    if (target.account_id) await purgeAccountFiles(admin, target.account_id);

    const { data: outcome, error: deleteError } = await admin.rpc('service_delete_account_for_website', {
      p_user_id: target.user_id,
      p_email: email,
    });
    if (deleteError) throw new Error(`delete failed: ${deleteError.code ?? 'unknown'}`);
    console.log('[website-account-deleted] outcome', outcome);
    return json({ ok: true, result: outcome === 'deleted' || outcome === 'protected' ? outcome : 'not_found' });
  } catch (error) {
    console.error('[website-account-deleted] failed', error instanceof Error ? error.message : 'unknown');
    return json({ ok: false, result: 'error' }, 500);
  }
});
