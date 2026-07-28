import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

Deno.serve(async (req) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') return new Response('ok', { headers });

  try {
    const { token } = await req.json() as { token: string };

    if (!token) {
      return new Response(JSON.stringify({ valid: false, reason: 'missing token' }), { headers, status: 400 });
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
      return new Response(JSON.stringify({ valid: false, reason: 'invalid or expired' }), { headers, status: 200 });
    }
    return new Response(JSON.stringify({ valid: true, account_id: data[0].account_id }), { headers, status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ valid: false, reason: String(err) }), { headers, status: 500 });
  }
});
