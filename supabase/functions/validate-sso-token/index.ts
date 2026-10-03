// validate-sso-token — redeems the one-time token the app appends to
// soberhelpline.com links (?sso_token=…). verify_jwt = false: the website calls
// it without an app session.
//
// Only the website's server (app-sso-exchange) may redeem, with header
// x-membership-sync-secret = MEMBERSHIP_SYNC_SECRET. It gets the member's
// verified email, first name and tier, so it can sign them in on the website
// and gate member pages on real membership. Without the secret the answer is
// 401 and the token is NOT spent (the older browser-side redeem, which only
// learned an account id, is gone).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { webSsoTier } from '../_shared/web-sso.ts';
import { requireSyncSecret } from '../_shared/sync-secret.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const headers = { 'Content-Type': 'application/json' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { headers, status });
}

Deno.serve(async (req) => {
  // Checked before the token is even read: an unauthenticated caller can't spend it.
  const authError = requireSyncSecret(req);
  if (authError) {
    return json({ valid: false, reason: authError.status === 405 ? 'method not allowed' : 'unauthorized' }, authError.status);
  }

  try {
    const body = await req.json().catch(() => null) as { token?: unknown } | null;
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    if (!/^[0-9a-f-]{36}$/i.test(token)) {
      return json({ valid: false, reason: 'missing token' }, 400);
    }

    // Atomically claim a valid, unused, unexpired token. The conditional UPDATE
    // (used_at IS NULL, unexpired) makes concurrent redeem requests race-safe:
    // only the first commits a row, the rest update 0 rows and fail closed.
    const { data, error } = await supabase
      .from('web_sso_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', token)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('account_id');
    if (error || !data || data.length === 0) {
      return json({ valid: false, reason: 'invalid or expired' });
    }
    const accountId = data[0].account_id as string;

    const { data: account } = await supabase
      .from('accounts')
      .select('user_id, first_name')
      .eq('id', accountId)
      .maybeSingle();
    const { data: user } = account?.user_id
      ? await supabase.auth.admin.getUserById(account.user_id as string)
      : { data: null };
    const email = user?.user?.email?.trim().toLowerCase();
    // The website needs the email to open a session; without one the token is spent and useless.
    if (!email || !user?.user?.email_confirmed_at) return json({ valid: false, reason: 'account unavailable' });

    const [premier, member] = await Promise.all([
      supabase.rpc('has_active_private_video_access', { p_account_id: accountId }),
      supabase.rpc('has_active_textline_access', { p_account_id: accountId }),
    ]);
    if (premier.error || member.error) return json({ valid: false, reason: 'unavailable' }, 503);
    const access = webSsoTier(premier.data === true, member.data === true);

    return json({
      valid: true,
      account_id: accountId,
      email,
      first_name: typeof account?.first_name === 'string' ? account.first_name : null,
      tier: access.tier,
      member: access.member,
    });
  } catch {
    return json({ valid: false, reason: 'unavailable' }, 500);
  }
});
