const ALLOWED_GROUP_ROOMS = new Set([
  'shp-parents',
  'shp-spouses',
  'shp-boundaries',
  'shp-treatment',
]);

const SESSION_KINDS = new Set([
  'admin_video_request',
  'coach_video_accepted',
  'coach_video_reschedule',
  'coach_video_cancelled',
  'coach_video_reminder',
  'member_video_scheduled',
  'member_video_counteroffer',
  'member_video_cancelled',
  'member_video_live',
  'member_video_completed',
  'member_video_no_show',
  'premier_video_reminder',
]);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const handledPushKeys: string[] = [];
const MAX_HANDLED_PUSH_KEYS = 64;

type PushData = Record<string, unknown>;

export type PushDestination =
  | { pathname: '/rehearsal-incoming'; params: { eventId: string } }
  | { pathname: '/live-room'; params: { room: string } }
  | { pathname: '/video-session'; params: { sessionId: string } }
  | { pathname: '/admin' }
  | { pathname: '/support' }
  | { pathname: '/(tabs)/boundaries' };

/**
 * Convert an untrusted notification payload into a fixed app destination.
 * The payload may supply identifiers only for explicit allowlisted routes; a
 * server-provided `screen` or deep-link string is never executed directly.
 */
export function getPushDestination(data: PushData, nowMs = Date.now()): PushDestination | null {
  const kind = typeof data.kind === 'string' ? data.kind : '';

  if (kind === 'practice_incoming') {
    const eventId = typeof data.event_id === 'string' ? data.event_id : '';
    const expiresAt = typeof data.expires_at === 'string' ? Date.parse(data.expires_at) : NaN;
    if (!UUID_PATTERN.test(eventId) || !Number.isFinite(expiresAt) || expiresAt <= nowMs) return null;
    return { pathname: '/rehearsal-incoming', params: { eventId } };
  }

  // Admin-only: a member sent a situation brief. Lands on the admin dashboard,
  // where the Situation Briefs inbox sits (no member data rides in the payload).
  if (kind === 'situation_brief') {
    return { pathname: '/admin' };
  }

  if (kind === 'family_backup') {
    return { pathname: '/(tabs)/boundaries' };
  }

  if (kind === 'group_live') {
    const roomName = typeof data.room_name === 'string' ? data.room_name : '';
    return ALLOWED_GROUP_ROOMS.has(roomName)
      ? { pathname: '/live-room', params: { room: roomName } }
      : null;
  }

  const sessionId = typeof data.session_id === 'string' ? data.session_id : '';
  if (!SESSION_KINDS.has(kind) || !UUID_PATTERN.test(sessionId)) return null;

  if (kind === 'member_video_live') {
    return { pathname: '/video-session', params: { sessionId } };
  }
  if (kind.startsWith('admin_') || kind.startsWith('coach_')) {
    return { pathname: '/admin' };
  }
  return { pathname: '/support' };
}

/**
 * Suppress duplicate taps/deliveries during the current app process. Practice
 * events use their opaque server event id, so an Expo retry with a new request
 * identifier still opens only once. Other notification types use the native
 * request identifier and preserve their existing behavior.
 */
export function shouldHandlePushResponse(data: PushData, requestIdentifier: string): boolean {
  const eventId = typeof data.event_id === 'string' && UUID_PATTERN.test(data.event_id)
    ? data.event_id
    : '';
  const key = eventId || requestIdentifier;
  if (!key || handledPushKeys.includes(key)) return false;
  handledPushKeys.push(key);
  if (handledPushKeys.length > MAX_HANDLED_PUSH_KEYS) handledPushKeys.shift();
  return true;
}
