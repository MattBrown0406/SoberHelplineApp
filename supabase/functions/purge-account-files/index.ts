// purge-account-files — called by the app right before delete_own_account.
//
// Database rows cascade when an account is deleted, but files in Storage do
// not: the member's Urgent Text Line photos (chat-attachments/<account_id>/…)
// would stay forever. This removes everything under the caller's own folder.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { purgeAccountFiles } from '../_shared/account-files.ts';

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
  const { data: account } = await userClient.from('accounts').select('id').eq('user_id', user.id).maybeSingle();
  if (!account?.id) return json({ ok: true, removed: 0 });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    return json({ ok: true, removed: await purgeAccountFiles(admin, account.id) });
  } catch (error) {
    console.error('[purge-account-files] failed', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'purge_failed' }, 500);
  }
});
