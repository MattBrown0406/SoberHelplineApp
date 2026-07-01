// LiveKit access-token minting — Supabase Edge Function
//
// The app NEVER holds the LiveKit API secret. It calls this function, which
// verifies the user's Supabase session, decides their role (host vs viewer),
// and returns a short-lived LiveKit JWT scoped to one room.
//
// Setup:
//   supabase secrets set LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=...
//   supabase functions deploy livekit-token
//
// Host rights (publish camera/mic + moderate) are granted only to accounts
// listed as a host for the group. Everyone else is view-only (canPublish=false),
// which is what keeps attendees anonymous — no attendee video, ever.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { AccessToken } from 'npm:livekit-server-sdk@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const { room } = await req.json();
    if (!room) return json({ error: 'room required' }, 400);

    // Verify caller via their Supabase JWT
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
      .select('id, first_name')
      .eq('user_id', user.id)
      .single();
    if (!account) return json({ error: 'no account' }, 403);

    // Host check: only the owner admin account may broadcast.
    // A stale/accidental group_hosts row is not enough to receive publish grants.
    const isAdmin = user.email?.trim().toLowerCase() === 'matt@soberhelpline.com';
    const { data: hostRow } = await supabase
      .from('group_hosts')
      .select('account_id')
      .eq('room_name', room)
      .eq('account_id', account.id)
      .maybeSingle();
    const isHost = isAdmin && !!hostRow;

    const at = new AccessToken(
      Deno.env.get('LIVEKIT_API_KEY')!,
      Deno.env.get('LIVEKIT_API_SECRET')!,
      {
        identity: account.id,
        name: account.first_name ?? 'Member',
        ttl: '2h',
      },
    );
    at.addGrant({
      room,
      roomJoin: true,
      canPublish: isHost,            // only hosts broadcast video/audio
      canPublishData: true,          // everyone can post chat/questions
      canSubscribe: true,
      roomAdmin: isHost,             // hosts can remove participants
    });

    return json({ token: await at.toJwt(), isHost, identity: account.id });
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
