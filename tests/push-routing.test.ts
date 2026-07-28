import assert from 'node:assert/strict';
import test from 'node:test';
import { getPushDestination, shouldHandlePushResponse } from '../src/lib/pushRouting';

const PRACTICE_EVENT_ID = '123e4567-e89b-42d3-a456-426614174111';
const BEFORE_EXPIRY = Date.parse('2026-07-28T19:00:00Z');

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
  assert.equal(
    getPushDestination({ kind: 'unknown', screen: '/rehearsal-incoming' }),
    null,
  );
});

test('preserves validated group-live routing', () => {
  assert.deepEqual(
    getPushDestination({ kind: 'group_live', room_name: 'shp-boundaries' }),
    { pathname: '/live-room', params: { room: 'shp-boundaries' } },
  );
  assert.equal(
    getPushDestination({ kind: 'group_live', room_name: 'attacker-room' }),
    null,
  );
});

test('preserves validated private-video routing', () => {
  const sessionId = '123e4567-e89b-42d3-a456-426614174000';
  assert.deepEqual(
    getPushDestination({ kind: 'member_video_live', session_id: sessionId }),
    { pathname: '/video-session', params: { sessionId } },
  );
  assert.equal(
    getPushDestination({ kind: 'member_video_live', session_id: 'not-a-uuid' }),
    null,
  );
});
