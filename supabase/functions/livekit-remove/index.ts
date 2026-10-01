// Remove a participant from a LiveKit room — host-only action.
// The roomAdmin grant in the host's JWT authorises the call, but we keep
// the LiveKit API secret server-side: the host calls this edge function,
// which verifies they are actually a host for the room, then removes the
// target participant via the LiveKit server SDK.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { RoomServiceClient } from 'npm:livekit-server-sdk@2';
import { isAdminEmail } from '../_shared/admin.ts';

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

    const isAdmin = isAdminEmail(user.email);
    const { data: hostRow } = await supabase
      .from('group_hosts')
      .select('account_id')
      .eq('room_name', room)
      .eq('account_id', account.id)
      .maybeSingle();
    if (!isAdmin || !hostRow) return json({ error: 'not an admin host for this room' }, 403);

    const svc = new RoomServiceClient(
      Deno.env.get('LIVEKIT_URL')!,
      Deno.env.get('LIVEKIT_API_KEY')!,
      Deno.env.get('LIVEKIT_API_SECRET')!,
    );
    // Removal is a ban: the token service refuses this member for every live
    // group until an admin lets them back. Ban first so it holds even if they
    // already left the room. Identities are account ids.
    let banned = false;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(identity))) {
      const { error: banError } = await supabase.rpc('admin_ban_from_live_groups', {
        p_account_id: identity,
        p_room_name: room,
      });
      if (banError) return json({ ok: false, banned: false, error: banError.message }, 500);
      banned = true;
    }

    try {
      await svc.removeParticipant(room, identity);
    } catch (error) {
      // Already gone from the room: the ban is what matters.
      if (!/not.?found/i.test(String(error))) throw error;
    }

    return json({ ok: true, banned });
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
