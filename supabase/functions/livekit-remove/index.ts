// Remove a participant from a LiveKit room — host-only action.
// The roomAdmin grant in the host's JWT authorises the call, but we keep
// the LiveKit API secret server-side: the host calls this edge function,
// which verifies they are actually a host for the room, then removes the
// target participant via the LiveKit server SDK.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { RoomServiceClient } from 'npm:livekit-server-sdk@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const { room, identity } = await req.json();
    if (!room || !identity) return json({ error: 'room and identity required' }, 400);

    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);

    const { data: account } = await supabase
      .from('accounts')
      .select('id')
      .eq('user_id', user.id)
      .single();
    if (!account) return json({ error: 'no account' }, 403);

    const { data: hostRow } = await supabase
      .from('group_hosts')
      .select('account_id')
      .eq('room_name', room)
      .eq('account_id', account.id)
      .maybeSingle();
    if (!hostRow) return json({ error: 'not a host for this room' }, 403);

    const svc = new RoomServiceClient(
      Deno.env.get('LIVEKIT_URL')!,
      Deno.env.get('LIVEKIT_API_KEY')!,
      Deno.env.get('LIVEKIT_API_SECRET')!,
    );
    await svc.removeParticipant(room, identity);

    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
