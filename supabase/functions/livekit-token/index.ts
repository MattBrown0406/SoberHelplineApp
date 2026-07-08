// LiveKit access-token minting — Supabase Edge Function
//
// The app NEVER holds the LiveKit API secret. It calls this function, which
// verifies the user's Supabase session, decides their role, and returns a
// short-lived LiveKit JWT scoped to one room.
//
// Room models:
//   1) Group/live rooms: Matt/admin can publish; members can watch/chat.
//   2) Premium private video rooms: Matt/admin and the session owner can both
//      publish camera/mic; everyone else is denied.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { AccessToken } from 'npm:livekit-server-sdk@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

type Account = {
  id: string;
  first_name: string | null;
};

type PrivateVideoSession = {
  id: string;
  account_id: string;
  room_name: string;
  status: 'requested' | 'scheduled' | 'live' | 'completed' | 'cancelled';
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const { room } = await req.json();
    if (!room) return json({ error: 'room required' }, 400);

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
      .single<Account>();
    if (!account) return json({ error: 'no account' }, 403);

    const isAdmin = user.email?.trim().toLowerCase() === 'matt@soberhelpline.com';
    const privateSession = await getPrivateVideoSession(supabase, room);

    if (privateSession) {
      return privateVideoToken(room, account, privateSession, isAdmin);
    }

    // Private-room namespace guard: if the caller asks for a premium-video-*
    // room but RLS shows them no session row, they are neither the owner nor
    // admin. Never fall through to a group viewer token for a private room —
    // that would let anyone holding a leaked room name silently watch a
    // private session.
    if (room.startsWith('premium-video-')) {
      return json({ error: 'not authorized for this private video session' }, 403);
    }

    return groupRoomToken(supabase, room, account, isAdmin);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

async function getPrivateVideoSession(supabase: ReturnType<typeof createClient>, room: string) {
  const { data, error } = await supabase
    .from('video_sessions')
    .select('id, account_id, room_name, status')
    .eq('room_name', room)
    .maybeSingle<PrivateVideoSession>();

  if (error) throw error;
  return data;
}

async function privateVideoToken(
  room: string,
  account: Account,
  session: PrivateVideoSession,
  isAdmin: boolean,
) {
  if (session.status === 'completed' || session.status === 'cancelled') {
    return json({ error: 'session closed' }, 403);
  }

  const isOwner = session.account_id === account.id;
  if (!isAdmin && !isOwner) {
    return json({ error: 'not authorized for this private video session' }, 403);
  }

  const token = await buildToken({
    room,
    account,
    canPublish: true,
    roomAdmin: isAdmin,
    ttl: '2h',
  });

  return json({
    token,
    isHost: isAdmin,
    isPrivateVideo: true,
    canPublish: true,
    identity: account.id,
  });
}

async function groupRoomToken(
  supabase: ReturnType<typeof createClient>,
  room: string,
  account: Account,
  isAdmin: boolean,
) {
  const { data: hostRow } = await supabase
    .from('group_hosts')
    .select('account_id')
    .eq('room_name', room)
    .eq('account_id', account.id)
    .maybeSingle();
  const isHost = isAdmin && !!hostRow;

  const token = await buildToken({
    room,
    account,
    canPublish: isHost,
    roomAdmin: isHost,
    ttl: '2h',
  });

  return json({
    token,
    isHost,
    isPrivateVideo: false,
    canPublish: isHost,
    identity: account.id,
  });
}

async function buildToken({
  room,
  account,
  canPublish,
  roomAdmin,
  ttl,
}: {
  room: string;
  account: Account;
  canPublish: boolean;
  roomAdmin: boolean;
  ttl: string;
}) {
  const at = new AccessToken(
    Deno.env.get('LIVEKIT_API_KEY')!,
    Deno.env.get('LIVEKIT_API_SECRET')!,
    {
      identity: account.id,
      name: account.first_name ?? 'Member',
      ttl,
    },
  );

  at.addGrant({
    room,
    roomJoin: true,
    canPublish,
    canPublishData: true,
    canSubscribe: true,
    roomAdmin,
  });

  return at.toJwt();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
