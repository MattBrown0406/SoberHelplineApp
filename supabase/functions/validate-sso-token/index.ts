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

    // Find a valid, unused, unexpired token
    const { data, error } = await supabase
      .from('web_sso_tokens')
      .select('id, account_id, expires_at, used_at')
      .eq('id', token)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error || !data) {
      return new Response(JSON.stringify({ valid: false, reason: 'invalid or expired' }), { headers, status: 200 });
    }

    // Mark it used
    await supabase
      .from('web_sso_tokens')
      .update({ used_at: new Date().toISOString() })
      .eq('id', token);

    return new Response(JSON.stringify({ valid: true, account_id: data.account_id }), { headers, status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ valid: false, reason: String(err) }), { headers, status: 500 });
  }
});
