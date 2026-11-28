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

test('routes an opted-in family backup notice to Boundaries, now a part of Practice', () => {
  assert.deepEqual(
    getPushDestination({ kind: 'family_backup' }),
    { pathname: '/(tabs)/scripts', params: { section: 'boundaries' } },
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
  // Without a valid session id the one-off plan-review card lives in Crisis Mode.
  assert.deepEqual(
    getPushDestination({ kind: 'member_video_live', session_id: 'not-a-uuid' }),
    { pathname: '/crisis-mode', params: { focus: 'session' } },
  );
});

test('"your session is live" opens the call for the session owner whatever her tier', () => {
  const sessionId = '123e4567-e89b-42d3-a456-426614174000';
  // A lapsed member who paid for a one-off plan review, or a cold start before
  // entitlements are known: livekit-token admits the session's own member.
  for (const entitlements of [entitlementsForAccountState('direct-free'), null]) {
    assert.deepEqual(
      getPushDestination({ kind: 'member_video_live', session_id: sessionId }, { entitlements }),
      { pathname: '/video-session', params: { sessionId } },
    );
  }
});

// ── Feature 3: one data contract, every tap lands somewhere safe ─────────────

const FREE = entitlementsForAccountState('direct-free');
const ESSENTIAL = entitlementsForAccountState('direct-essential');
const PREMIER = entitlementsForAccountState('direct-premium');
const SESSION_ID = '123e4567-e89b-42d3-a456-426614174222';
const THREAD_ID = '123e4567-e89b-42d3-a456-426614174333';

test('coach reply always opens Chat (read-only for members off the Text Line plan)', () => {
  assert.deepEqual(getPushDestination({ kind: 'coach_message', thread_id: THREAD_ID }, { entitlements: ESSENTIAL }), { pathname: '/chat' });
  // Free members read replies to their situation briefs in Chat (read-only).
  assert.deepEqual(getPushDestination({ kind: 'coach_message' }, { entitlements: FREE }), { pathname: '/chat' });
  assert.deepEqual(
    getPushDestination({ kind: 'admin_textline_message', thread_id: THREAD_ID }, { entitlements: PREMIER }),
    { pathname: '/admin-thread', params: { threadId: THREAD_ID } },
  );
  assert.deepEqual(getPushDestination({ kind: 'coach_message' }), { pathname: '/chat' });
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
  assert.deepEqual(getPushDestination({ kind: 'morning_note', screen: 'boundaries' }), { pathname: '/(tabs)/scripts', params: { section: 'boundaries' } });
  // The Tracker is a pushed screen since 4.4: the old hint opens it directly.
  assert.deepEqual(getPushDestination({ kind: 'daily_nudge', screen: 'tracker' }), { pathname: '/tracker' });
  assert.deepEqual(getPushDestination({ kind: 'morning_note', screen: 'learn' }), { pathname: '/(tabs)/learn' });
  assert.deepEqual(getPushDestination({ kind: 'morning_note', screen: 'support' }), { pathname: '/(tabs)/support' });
  assert.deepEqual(getPushDestination({ kind: 'morning_note' }), { pathname: '/(tabs)' });
  assert.deepEqual(getPushDestination({ kind: 'daily_nudge', screen: 'today' }), { pathname: '/(tabs)' });
  assert.deepEqual(getPushDestination({ kind: 'daily_nudge', screen: '/video-session' }), { pathname: '/(tabs)' });
});

test('winback opens Today with "More for you" open, never the /guided-journey hop', () => {
  const now = Date.parse('2026-11-25T12:00:00Z');
  assert.deepEqual(
    getPushDestination({ kind: 'winback' }, { entitlements: FREE, nowMs: now }),
    { pathname: '/(tabs)', params: { more: '1', n: String(now) } },
  );
  // A fresh `n` on every tap, so a repeat winback opens "More for you" again.
  assert.notDeepEqual(
    getPushDestination({ kind: 'winback' }, { nowMs: now }),
    getPushDestination({ kind: 'winback' }, { nowMs: now + 1 }),
  );
  assert.doesNotMatch(readFileSync('src/lib/pushRouting.ts', 'utf8'), /pathname: '\/guided-journey'/);
  // The old route stays for older links, and pops back to the tabs below it
  // (POP_TO) instead of replacing itself with a second copy of the tabs.
  const route = readFileSync('app/guided-journey.tsx', 'utf8');
  assert.match(route, /router\.dismissTo\(\{ pathname: '\/\(tabs\)', params: \{ more: '1', n: visit \} \}\)/);
  assert.doesNotMatch(route, /<Redirect href|router\.(push|replace)\(/);
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
  assert.deepEqual(getPushDestination({ kind: 'member_video_live', session_id: sessionId }, { entitlements: ESSENTIAL }), { pathname: '/video-session', params: { sessionId } });
  assert.deepEqual(getPushDestination({ kind: 'member_video_live', session_id: sessionId }, { entitlements: FREE }), { pathname: '/video-session', params: { sessionId } });
  assert.deepEqual(getPushDestination({ kind: 'member_video_scheduled', session_id: sessionId }, { entitlements: FREE }), { pathname: '/crisis-mode', params: { focus: 'session' } });
  assert.deepEqual(getPushDestination({ kind: 'member_plan_update_requested', session_id: sessionId }, { entitlements: ESSENTIAL }), { pathname: '/crisis-mode', params: { focus: 'session' } });
  assert.deepEqual(getPushDestination({ kind: 'admin_refund_owed', session_id: sessionId }, { entitlements: PREMIER }), { pathname: '/admin' });
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

test('Invitation Engine window push opens the engine for paid members and Today otherwise', () => {
  assert.deepEqual(getPushDestination({ kind: 'invitation_window' }, { entitlements: ESSENTIAL }), { pathname: '/invitation-engine' });
  assert.deepEqual(getPushDestination({ kind: 'invitation_window' }, { entitlements: PREMIER }), { pathname: '/invitation-engine' });
  assert.deepEqual(getPushDestination({ kind: 'invitation_window' }, { entitlements: FREE }), { pathname: '/(tabs)' });
  assert.deepEqual(getPushDestination({ kind: 'invitation_window' }), { pathname: '/(tabs)' });
  assert.deepEqual(getPushDestination({ kind: 'invitation_window', screen: '/admin' }, { entitlements: FREE }), { pathname: '/(tabs)' });
});

test('an admin YES alert opens the admin dashboard', () => {
  assert.deepEqual(getPushDestination({ kind: 'admin_invitation_yes' }), { pathname: '/admin' });
  assert.deepEqual(getPushDestination({ kind: 'admin_invitation_yes' }, { entitlements: FREE }), { pathname: '/admin' });
});

test('the invitation SQL producers enqueue exactly the routed kinds', () => {
  const sql = readFileSync('supabase/migrations/20261001100000_invitation_engine.sql', 'utf8');
  const kinds = [...sql.matchAll(/jsonb_build_object\('kind', '([a-z_]+)'\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(kinds, ['admin_invitation_yes', 'invitation_window']);
  const router = readFileSync('src/lib/pushRouting.ts', 'utf8');
  for (const kind of kinds) assert.match(router, new RegExp(`'${kind}'`), kind);
});

test('a member asking Matt to reach out opens Admin (staff only), whatever the tapper\'s tier', () => {
  const data = {
    kind: 'admin_reach_out',
    request_id: '123e4567-e89b-42d3-a456-426614174333',
    member_account_id: '123e4567-e89b-42d3-a456-426614174444',
  };
  for (const entitlements of [FREE, ESSENTIAL, PREMIER, null]) {
    assert.deepEqual(getPushDestination(data, { entitlements }), { pathname: '/admin' });
  }
  // The payload never carries a deep link the app would follow.
  assert.deepEqual(getPushDestination({ ...data, screen: 'support', deep_link: 'soberhelpline://chat' }), { pathname: '/admin' });
  // The SQL producer sends exactly this kind and payload shape.
  const sql = readFileSync('supabase/migrations/20261124120000_checkin_reach_out_requests.sql', 'utf8');
  assert.match(sql, /jsonb_build_object\('kind', 'admin_reach_out', 'request_id', v_request, 'member_account_id', v_account\)/);
  assert.match(sql, /WHEN 'admin_reach_out' THEN/);
});

test('an old 4.3 "a family lost their loved one" push opens Admin for staff, like a reach-out request', () => {
  assert.deepEqual(getPushDestination({ kind: 'admin_bereavement' }), { pathname: '/admin' });
  assert.deepEqual(getPushDestination({ kind: 'admin_bereavement' }, { entitlements: FREE }), { pathname: '/admin' });
  assert.deepEqual(
    getPushDestination({ kind: 'admin_bereavement' }, { entitlements: FREE }),
    getPushDestination({ kind: 'admin_reach_out', request_id: PRACTICE_EVENT_ID }, { entitlements: FREE }),
  );
  assert.match(readFileSync('src/lib/pushRouting.ts', 'utf8'), /if \(kind === 'admin_bereavement'\) \{\s*return \{ pathname: '\/admin' \};/);
});

 test('meeting question alerts open the persistent admin answer queue', () => {
  assert.deepEqual(getPushDestination({kind:'admin_session_question', question_id:'123e4567-e89b-42d3-a456-426614174111'}), {pathname:'/admin'});
});
