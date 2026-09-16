import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { getPushDestination, shouldHandlePushResponse } from '../src/lib/pushRouting';
import { entitlementsForAccountState } from '../src/lib/featureAccess';

const PRACTICE_EVENT_ID = '123e4567-e89b-42d3-a456-426614174111';
const BEFORE_EXPIRY = Date.parse('2026-07-28T19:00:00Z');

test('accepts the Postgres timestamptz text form the practice-call producer emits', () => {
  for (const expires_at of ['2026-07-28 20:00:00+00', '2026-07-28 20:00:00.123456+00', '2026-07-28 13:00:00-07']) {
    assert.deepEqual(
      getPushDestination({ kind: 'practice_incoming', event_id: PRACTICE_EVENT_ID, expires_at }, BEFORE_EXPIRY),
      { pathname: '/rehearsal-incoming', params: { eventId: PRACTICE_EVENT_ID } },
      expires_at,
    );
  }
  assert.equal(
    getPushDestination({ kind: 'practice_incoming', event_id: PRACTICE_EVENT_ID, expires_at: '2026-07-28 18:00:00+00' }, BEFORE_EXPIRY),
    null,
  );
});

test('routes a valid unexpired practice call push to the incoming rehearsal', () => {
  assert.deepEqual(
    getPushDestination({
      kind: 'practice_incoming',
      screen: 'rehearsal-incoming',
      event_id: PRACTICE_EVENT_ID,
      expires_at: '2026-07-28T20:00:00Z',
    }, BEFORE_EXPIRY),
    { pathname: '/rehearsal-incoming', params: { eventId: PRACTICE_EVENT_ID } },
  );
});

test('rejects expired or malformed practice call events', () => {
  assert.equal(getPushDestination({
    kind: 'practice_incoming',
    event_id: PRACTICE_EVENT_ID,
    expires_at: '2026-07-28T20:00:00Z',
  }, Date.parse('2026-07-28T20:00:00Z')), null);
  assert.equal(getPushDestination({
    kind: 'practice_incoming',
    event_id: 'not-a-uuid',
    expires_at: '2026-07-29T20:00:00Z',
  }, BEFORE_EXPIRY), null);
});

test('deduplicates practice deliveries by opaque event id', () => {
  const data = { kind: 'practice_incoming', event_id: PRACTICE_EVENT_ID };
  assert.equal(shouldHandlePushResponse(data, 'native-request-a'), true);
  assert.equal(shouldHandlePushResponse(data, 'native-request-b'), false);
});

test('does not let an arbitrary screen field choose a route', () => {
  assert.deepEqual(
    getPushDestination({ kind: 'unknown', screen: '/rehearsal-incoming' }),
    { pathname: '/(tabs)' },
  );
});

test('routes an opted-in family backup notice to Boundaries', () => {
  assert.deepEqual(
    getPushDestination({ kind: 'family_backup' }),
    { pathname: '/(tabs)/boundaries' },
  );
});

test('preserves validated group-live routing', () => {
  assert.deepEqual(
    getPushDestination({ kind: 'group_live', room_name: 'shp-boundaries' }, { entitlements: entitlementsForAccountState('direct-essential') }),
    { pathname: '/live-room', params: { room: 'shp-boundaries' } },
  );
  assert.deepEqual(
    getPushDestination({ kind: 'group_live', room_name: 'attacker-room' }),
    { pathname: '/(tabs)' },
  );
});

test('preserves validated private-video routing', () => {
  const sessionId = '123e4567-e89b-42d3-a456-426614174000';
  assert.deepEqual(
    getPushDestination({ kind: 'member_video_live', session_id: sessionId }, { entitlements: entitlementsForAccountState('direct-premium') }),
    { pathname: '/video-session', params: { sessionId } },
  );
  assert.deepEqual(
    getPushDestination({ kind: 'member_video_live', session_id: 'not-a-uuid' }),
    { pathname: '/(tabs)/support' },
  );
});

// ── Feature 3: one data contract, every tap lands somewhere safe ─────────────

const FREE = entitlementsForAccountState('direct-free');
const ESSENTIAL = entitlementsForAccountState('direct-essential');
const PREMIER = entitlementsForAccountState('direct-premium');
const SESSION_ID = '123e4567-e89b-42d3-a456-426614174222';
const THREAD_ID = '123e4567-e89b-42d3-a456-426614174333';

test('coach reply opens the thread for members who can message, Support otherwise', () => {
  assert.deepEqual(getPushDestination({ kind: 'coach_message', thread_id: THREAD_ID }, { entitlements: ESSENTIAL }), { pathname: '/chat' });
  assert.deepEqual(getPushDestination({ kind: 'coach_message' }, { entitlements: FREE }), { pathname: '/(tabs)/support' });
  assert.deepEqual(getPushDestination({ kind: 'coach_message' }), { pathname: '/(tabs)/support' });
});

test('member message opens the admin thread when the id is a uuid, the admin home otherwise', () => {
  assert.deepEqual(getPushDestination({ kind: 'member_message', thread_id: THREAD_ID }), { pathname: '/admin-thread', params: { threadId: THREAD_ID } });
  assert.deepEqual(getPushDestination({ kind: 'member_message', thread_id: '../etc' }), { pathname: '/admin' });
});

test('session reminder carries the RSVP session to Support, or the live room when allowed', () => {
  assert.deepEqual(
    getPushDestination({ kind: 'session_reminder', session_id: SESSION_ID }, { entitlements: FREE }),
    { pathname: '/(tabs)/support', params: { sessionId: SESSION_ID } },
  );
  assert.deepEqual(getPushDestination({ kind: 'session_reminder' }), { pathname: '/(tabs)/support' });
  assert.deepEqual(
    getPushDestination({ kind: 'session_reminder', room_name: 'shp-parents' }, { entitlements: ESSENTIAL }),
    { pathname: '/live-room', params: { room: 'shp-parents' } },
  );
  assert.deepEqual(
    getPushDestination({ kind: 'session_reminder', room_name: 'shp-parents', session_id: SESSION_ID }, { entitlements: FREE }),
    { pathname: '/(tabs)/support', params: { sessionId: SESSION_ID } },
  );
});

test('morning note and daily nudge open a tab from an allowlisted hint, defaulting to Today', () => {
  assert.deepEqual(getPushDestination({ kind: 'morning_note', screen: 'boundaries' }), { pathname: '/(tabs)/boundaries' });
  assert.deepEqual(getPushDestination({ kind: 'morning_note', screen: 'support' }), { pathname: '/(tabs)/support' });
  assert.deepEqual(getPushDestination({ kind: 'morning_note' }), { pathname: '/(tabs)' });
  assert.deepEqual(getPushDestination({ kind: 'daily_nudge', screen: 'today' }), { pathname: '/(tabs)' });
  assert.deepEqual(getPushDestination({ kind: 'daily_nudge', screen: '/video-session' }), { pathname: '/(tabs)' });
});

test('winback opens the guided journey', () => {
  assert.deepEqual(getPushDestination({ kind: 'winback' }, { entitlements: FREE }), { pathname: '/guided-journey' });
});

test('unknown and legacy payloads open the app on a tab and never a gated screen', () => {
  assert.deepEqual(getPushDestination({}), { pathname: '/(tabs)' });
  assert.deepEqual(getPushDestination({ kind: 42 }), { pathname: '/(tabs)' });
  assert.deepEqual(getPushDestination({ screen: 'support' }), { pathname: '/(tabs)/support' });
  assert.deepEqual(getPushDestination({ screen: 'premier-video', deep_link: 'soberhelpline://premier-video/x' }), { pathname: '/(tabs)' });
  assert.deepEqual(getPushDestination({ kind: 'group_live', room_name: 'attacker-room' }), { pathname: '/(tabs)' });
  assert.deepEqual(getPushDestination({ kind: 'member_video_live', session_id: 'not-a-uuid' }, { entitlements: PREMIER }), { pathname: '/(tabs)/support' });
});

test('gated destinations fall back to Support for accounts without the entitlement', () => {
  const sessionId = '123e4567-e89b-42d3-a456-426614174000';
  assert.deepEqual(getPushDestination({ kind: 'group_live', room_name: 'shp-boundaries' }, { entitlements: FREE }), { pathname: '/(tabs)/support' });
  assert.deepEqual(getPushDestination({ kind: 'group_live', room_name: 'shp-boundaries' }, { entitlements: ESSENTIAL }), { pathname: '/live-room', params: { room: 'shp-boundaries' } });
  assert.deepEqual(getPushDestination({ kind: 'member_video_live', session_id: sessionId }, { entitlements: ESSENTIAL }), { pathname: '/(tabs)/support' });
  assert.deepEqual(getPushDestination({ kind: 'member_video_live', session_id: sessionId }, { entitlements: PREMIER }), { pathname: '/video-session', params: { sessionId } });
  assert.deepEqual(getPushDestination({ kind: 'premier_video_reminder', session_id: sessionId }, { entitlements: PREMIER }), { pathname: '/(tabs)/support' });
  assert.deepEqual(getPushDestination({ kind: 'coach_video_reminder', session_id: sessionId }), { pathname: '/admin' });
});

test('every producer kind in supabase/functions is routed by the client', () => {
  const contract = readFileSync('supabase/functions/_shared/push-data.ts', 'utf8');
  const kinds = [...contract.matchAll(/kind: "([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(kinds.length >= 7, 'contract kinds');
  const router = readFileSync('src/lib/pushRouting.ts', 'utf8');
  for (const kind of new Set(kinds)) assert.match(router, new RegExp(`'${kind}'`), kind);
  for (const fn of ['notify-daily-morning', 'notify-session-reminder', 'notify-chat-message', 'send-engagement-push', 'notify-family-backup', 'daily-nudge']) {
    const source = readFileSync(`supabase/functions/${fn}/index.ts`, 'utf8');
    assert.match(source, /_shared\/push-data\.ts/, fn);
    assert.doesNotMatch(source, /data: \{ (screen|kind):/, `${fn} builds data by hand`);
  }
});
