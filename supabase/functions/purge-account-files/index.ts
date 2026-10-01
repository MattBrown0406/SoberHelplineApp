// purge-account-files — called by the app right before delete_own_account.
//
// Database rows cascade when an account is deleted, but files in Storage do
// not: the member's Urgent Text Line photos (chat-attachments/<account_id>/…)
// would stay forever. This removes everything under the caller's own folder.

import { createClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'chat-attachments';
const PAGE = 100;
const MAX_DEPTH = 4;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

type Bucket = ReturnType<ReturnType<typeof createClient>['storage']['from']>;

async function listFiles(bucket: Bucket, prefix: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) return [];
  const files: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await bucket.list(prefix, { limit: PAGE, offset });
    if (error) throw error;
    for (const item of data ?? []) {
      const path = `${prefix}/${item.name}`;
      // Folders come back without an id.
      if (item.id === null) files.push(...await listFiles(bucket, path, depth + 1));
      else files.push(path);
    }
    if (!data || data.length < PAGE) return files;
  }
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
  const bucket = admin.storage.from(BUCKET);
  try {
    const files = await listFiles(bucket, account.id);
    for (let i = 0; i < files.length; i += PAGE) {
      const { error } = await bucket.remove(files.slice(i, i + PAGE));
      if (error) throw error;
    }
    return json({ ok: true, removed: files.length });
  } catch (error) {
    console.error('[purge-account-files] failed', error instanceof Error ? error.message : 'unknown');
    return json({ error: 'purge_failed' }, 500);
  }
});
