// LiveKit access-token minting — Supabase Edge Function
// Private rooms are resolved from a session id; client-supplied room names are
// accepted only for the backwards-compatible group-room flow.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { AccessToken } from 'npm:livekit-server-sdk@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

type Account = { id: string; first_name: string | null };
type StaffRole = { role: 'owner' | 'coach'; active: boolean };
type PrivateVideoSession = {
  id: string;
  account_id: string;
  assigned_coach_id: string | null;
  room_name: string;
  status: 'requested' | 'scheduled' | 'live' | 'completed' | 'cancelled' | 'no_show';
  scheduled_for: string | null;
  duration_minutes: number;
  started_at: string | null;
  archived_at: string | null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const body = await req.json().catch(() => null) as { sessionId?: unknown; room?: unknown } | null;
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
    const requestedRoom = typeof body?.room === 'string' ? body.room.trim() : '';
    if (!sessionId && !requestedRoom) return json({ error: 'sessionId_or_room_required' }, 400);
    if (sessionId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
      return json({ error: 'invalid_sessionId' }, 400);
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({ error: 'not_authenticated' }, 401);

    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('id, first_name')
      .eq('user_id', user.id)
      .single<Account>();
    if (accountError || !account) return json({ error: 'account_not_found' }, 403);

    if (sessionId) {
      const privateSession = await getPrivateVideoSession(supabase, sessionId);
      if (!privateSession) return json({ error: 'private_session_not_found_or_not_authorized' }, 403);
      const staffRole = await getStaffRole(supabase, account.id);
      return privateVideoToken(account, privateSession, staffRole);
    }

    // A private room name must never select or authorize a private session. This
    // also prevents a leaked name from falling through to a group viewer token.
    if (requestedRoom.startsWith('premium-video-')) {
      return json({ error: 'private_sessions_require_sessionId' }, 403);
    }

    return groupRoomToken(supabase, requestedRoom, account, user.email?.trim().toLowerCase() === 'matt@soberhelpline.com');
  } catch (error) {
    console.error('livekit-token:', error);
    return json({ error: 'token_request_failed' }, 500);
  }
});

type EdgeSupabase = ReturnType<typeof createClient<any>>;

async function getPrivateVideoSession(supabase: EdgeSupabase, sessionId: string) {
  const { data, error } = await supabase
    .from('video_sessions')
    .select('id, account_id, assigned_coach_id, room_name, status, scheduled_for, duration_minutes, started_at, archived_at')
    .eq('id', sessionId)
    .maybeSingle<PrivateVideoSession>();
  if (error) throw error;
  return data;
}

async function getStaffRole(supabase: EdgeSupabase, accountId: string) {
  const { data, error } = await supabase
    .from('video_staff_roles')
    .select('role, active')
    .eq('account_id', accountId)
    .eq('active', true)
    .maybeSingle<StaffRole>();
  if (error) throw error;
  return data;
}

function privateAdmissionError(
  account: Account,
  session: PrivateVideoSession,
  staffRole: StaffRole | null,
  now = Date.now(),
): string | null {
  if (session.archived_at) return 'private_session_archived';
  if (session.status === 'requested') return 'private_session_not_scheduled';
  if (!['scheduled', 'live'].includes(session.status)) return 'private_session_closed';

  const isMember = session.account_id === account.id;
  const isOwnerStaff = staffRole?.active === true && staffRole.role === 'owner';
  const isAssignedCoach = staffRole?.active === true && session.assigned_coach_id === account.id;

  const scheduledStart = session.scheduled_for ? Date.parse(session.scheduled_for) : NaN;
  const startedAt = session.started_at ? Date.parse(session.started_at) : NaN;
  // Even a row accidentally left `live` has a hard end. The started-at bound is
  // capped at four hours and the scheduled contract gets duration + 30 minutes.
  const scheduledCutoff = Number.isFinite(scheduledStart)
    ? scheduledStart + session.duration_minutes * 60_000 + 30 * 60_000 : Infinity;
  const liveCutoff = Number.isFinite(startedAt) ? startedAt + 4 * 60 * 60_000 : Infinity;
  if (now > Math.min(scheduledCutoff, liveCutoff)) return 'private_session_join_window_closed';

  if (staffRole?.active && (isOwnerStaff || isAssignedCoach)) return null;
  if (!isMember) return 'not_authorized_for_private_session';
  if (session.status === 'live') return null;
  if (!session.scheduled_for) return 'private_session_schedule_missing';

  const startsAt = Date.parse(session.scheduled_for);
  if (!Number.isFinite(startsAt)) return 'private_session_schedule_invalid';
  const opensAt = startsAt - 10 * 60_000;
  const closesAt = startsAt + session.duration_minutes * 60_000 + 30 * 60_000;
  if (now < opensAt) return 'private_session_not_open_yet';
  if (now > closesAt) return 'private_session_join_window_closed';
  return null;
}

async function privateVideoToken(account: Account, session: PrivateVideoSession, staffRole: StaffRole | null) {
  const admissionError = privateAdmissionError(account, session, staffRole);
  if (admissionError) return json({ error: admissionError }, 403);

  const isStaff = staffRole?.active === true;
  const token = await buildToken({
    room: session.room_name,
    account,
    canPublish: true,
    roomAdmin: isStaff && staffRole.role === 'owner',
    ttl: '2h',
  });
  return json({
    token,
    sessionId: session.id,
    room: session.room_name,
    isHost: isStaff,
    isPrivateVideo: true,
    canPublish: true,
    identity: account.id,
  });
}

async function groupRoomToken(
  supabase: EdgeSupabase,
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
  const token = await buildToken({ room, account, canPublish: isHost, roomAdmin: isHost, ttl: '2h' });
  return json({ token, sessionId: null, room, isHost, isPrivateVideo: false, canPublish: isHost, identity: account.id });
}

async function buildToken({ room, account, canPublish, roomAdmin, ttl }: {
  room: string;
  account: Account;
  canPublish: boolean;
  roomAdmin: boolean;
  ttl: string;
}) {
  const token = new AccessToken(
    Deno.env.get('LIVEKIT_API_KEY')!,
    Deno.env.get('LIVEKIT_API_SECRET')!,
    { identity: account.id, name: account.first_name ?? 'Member', ttl },
  );
  token.addGrant({ room, roomJoin: true, canPublish, canPublishData: true, canSubscribe: true, roomAdmin });
  return token.toJwt();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
