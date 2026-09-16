import type { Entitlements, ProductFeature } from '../api/types';
import { canAccessFeature } from './featureAccess';

/**
 * Push `data` contract — the only thing a notification tap may say to the app.
 *
 * Every producer (edge functions and `push_outbox` rows) sends
 * `data: { kind, ...ids }`. The client maps `kind` to a fixed destination and
 * validates any id before using it; a `screen` value is only ever an allowlisted
 * tab name and a `deep_link` string is never executed.
 *
 * | kind                       | ids                    | destination                                   |
 * | -------------------------- | ---------------------- | --------------------------------------------- |
 * | practice_incoming          | event_id, expires_at   | /rehearsal-incoming (discarded when expired)  |
 * | coach_message              | thread_id?             | /chat (coach messaging) else Support           |
 * | member_message             | thread_id?             | /admin-thread (coach device)                   |
 * | session_reminder           | session_id?, room_name?| /live-room (community) or Support + session_id |
 * | morning_note, daily_nudge  | screen? (tab name)     | that tab, default Today                        |
 * | winback                    | —                      | /guided-journey                                |
 * | family_backup              | wavering_event_id?     | Boundaries (where the family wall lives)       |
 * | group_live                 | room_name              | /live-room (community) else Support            |
 * | situation_brief            | —                      | /admin                                         |
 * | *_video_* (see below)      | session_id             | /video-session (private video), /admin, Support|
 * | anything else / no kind    | screen? (tab name)     | that tab, default Today — never a crash        |
 *
 * Gated destinations are checked against the same feature map screens use, so
 * a tap never lands a member on a screen they cannot open.
 */
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

/** Legacy `screen` hints (morning note, daily nudge) may only pick a tab. */
const TAB_SCREENS: Readonly<Record<string, PushDestination>> = Object.freeze({
  today: { pathname: '/(tabs)' },
  home: { pathname: '/(tabs)' },
  support: { pathname: '/(tabs)/support' },
  boundaries: { pathname: '/(tabs)/boundaries' },
  tracker: { pathname: '/(tabs)/tracker' },
  learn: { pathname: '/(tabs)/learn' },
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const handledPushKeys: string[] = [];
const MAX_HANDLED_PUSH_KEYS = 64;

type PushData = Record<string, unknown>;

export type PushDestination =
  | { pathname: '/rehearsal-incoming'; params: { eventId: string } }
  | { pathname: '/live-room'; params: { room: string } }
  | { pathname: '/video-session'; params: { sessionId: string } }
  | { pathname: '/chat' }
  | { pathname: '/admin-thread'; params: { threadId: string } }
  | { pathname: '/admin' }
  | { pathname: '/guided-journey' }
  | { pathname: '/(tabs)' }
  | { pathname: '/(tabs)/support'; params?: { sessionId: string } }
  | { pathname: '/(tabs)/boundaries' }
  | { pathname: '/(tabs)/tracker' }
  | { pathname: '/(tabs)/learn' };

export type PushRoutingOptions = {
  nowMs?: number;
  /** Account entitlements; `null` (unknown) treats every gated screen as closed. */
  entitlements?: Entitlements | null;
};

const HOME: PushDestination = { pathname: '/(tabs)' };
const SUPPORT: PushDestination = { pathname: '/(tabs)/support' };

// The practice-call producer emits `timestamptz::text` ("2026-07-28 20:00:00+00"),
// not ISO 8601. Hermes' Date.parse is only guaranteed for the ISO form, and an
// unparseable expiry would silently discard the tap. Normalize before parsing.
function parseTimestamp(value: unknown): number {
  if (typeof value !== 'string') return NaN;
  const iso = value
    .trim()
    .replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)/, '$1T$2')
    .replace(/([+-]\d{2})$/, '$1:00');
  return Date.parse(iso);
}

function uuidField(data: PushData, key: string): string {
  const value = data[key];
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : '';
}

function tabFromScreenHint(data: PushData): PushDestination {
  const screen = typeof data.screen === 'string' ? data.screen.trim().toLowerCase() : '';
  return TAB_SCREENS[screen] ?? HOME;
}

/**
 * Convert an untrusted notification payload into a fixed app destination.
 * The payload may supply identifiers only for explicit allowlisted routes; a
 * server-provided `screen` or deep-link string is never executed directly.
 * Returns `null` only for a practice call that is expired or malformed — every
 * other payload, including ones this build does not recognise, opens the app.
 */
export function getPushDestination(data: PushData, options: PushRoutingOptions | number = {}): PushDestination | null {
  const { nowMs = Date.now(), entitlements = null } = typeof options === 'number' ? { nowMs: options } : options;
  const allowed = (feature: ProductFeature) => entitlements !== null && canAccessFeature({ feature, entitlements });
  const kind = typeof data.kind === 'string' ? data.kind : '';

  if (kind === 'practice_incoming') {
    const eventId = uuidField(data, 'event_id');
    const expiresAt = parseTimestamp(data.expires_at);
    if (!eventId || !Number.isFinite(expiresAt) || expiresAt <= nowMs) return null;
    return { pathname: '/rehearsal-incoming', params: { eventId } };
  }

  if (kind === 'coach_message') {
    return allowed('coachMessaging') ? { pathname: '/chat' } : SUPPORT;
  }

  if (kind === 'member_message') {
    const threadId = uuidField(data, 'thread_id');
    return threadId ? { pathname: '/admin-thread', params: { threadId } } : { pathname: '/admin' };
  }

  if (kind === 'session_reminder') {
    const roomName = typeof data.room_name === 'string' ? data.room_name : '';
    if (ALLOWED_GROUP_ROOMS.has(roomName) && allowed('community')) {
      return { pathname: '/live-room', params: { room: roomName } };
    }
    const sessionId = uuidField(data, 'session_id');
    return sessionId ? { pathname: '/(tabs)/support', params: { sessionId } } : SUPPORT;
  }

  if (kind === 'morning_note' || kind === 'daily_nudge') {
    return tabFromScreenHint(data);
  }

  if (kind === 'winback') {
    return { pathname: '/guided-journey' };
  }

  // Admin-only: a member sent a situation brief. Lands on the admin dashboard,
  // where the Situation Briefs inbox sits (no member data rides in the payload).
  if (kind === 'situation_brief') {
    return { pathname: '/admin' };
  }

  // A relative opted in to share that they are wavering on a wall; the wall
  // and its backup notices live on Boundaries.
  if (kind === 'family_backup') {
    return { pathname: '/(tabs)/boundaries' };
  }

  if (kind === 'group_live') {
    const roomName = typeof data.room_name === 'string' ? data.room_name : '';
    if (!ALLOWED_GROUP_ROOMS.has(roomName)) return HOME;
    return allowed('community') ? { pathname: '/live-room', params: { room: roomName } } : SUPPORT;
  }

  if (SESSION_KINDS.has(kind)) {
    const sessionId = uuidField(data, 'session_id');
    if (kind.startsWith('admin_') || kind.startsWith('coach_')) {
      return { pathname: '/admin' };
    }
    if (kind === 'member_video_live' && sessionId && allowed('privateVideo')) {
      return { pathname: '/video-session', params: { sessionId } };
    }
    return SUPPORT;
  }

  // Unknown or legacy payload: open the app on a tab, never a gated screen.
  return tabFromScreenHint(data);
}

/**
 * Suppress duplicate taps/deliveries during the current app process. Practice
 * events use their opaque server event id, so an Expo retry with a new request
 * identifier still opens only once. Other notification types use the native
 * request identifier and preserve their existing behavior.
 */
export function shouldHandlePushResponse(data: PushData, requestIdentifier: string): boolean {
  const eventId = uuidField(data, 'event_id');
  const key = eventId || requestIdentifier;
  if (!key || handledPushKeys.includes(key)) return false;
  handledPushKeys.push(key);
  if (handledPushKeys.length > MAX_HANDLED_PUSH_KEYS) handledPushKeys.shift();
  return true;
}
