import {
  INVITATION_WINDOW_PUSH_TTL_SECONDS,
  PRACTICE_PUSH_TTL_SECONDS,
  pushDeliveryPolicy,
} from './push-policy.ts';

function assertEquals(actual: unknown, expected: unknown, message: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test('practice pushes expire at the provider after four hours', () => {
  assertEquals(PRACTICE_PUSH_TTL_SECONDS, 14_400, 'TTL constant');
  assertEquals(pushDeliveryPolicy('practice_incoming'), { ttl: 14_400 }, 'practice policy');
});

Deno.test('existing notification kinds retain their delivery policy', () => {
  assertEquals(pushDeliveryPolicy('group_live'), {}, 'group-live policy');
  assertEquals(pushDeliveryPolicy('premier_video_reminder'), {}, 'video policy');
});

Deno.test('invitation window pushes use an absolute deadline and fail closed without one', () => {
  const now = Date.parse('2026-10-01T20:00:00Z');
  assertEquals(INVITATION_WINDOW_PUSH_TTL_SECONDS, 14_400, 'TTL constant');
  assertEquals(pushDeliveryPolicy('invitation_window'), { ttl: 0 }, 'missing expiry');
  assertEquals(pushDeliveryPolicy('invitation_window', 'invalid', now), { ttl: 0 }, 'invalid expiry');
  assertEquals(pushDeliveryPolicy('invitation_window', '2026-09-30T21:00:00Z', now), { ttl: 0 }, 'backlog');
  assertEquals(pushDeliveryPolicy('invitation_window', '2026-10-01T20:15:00Z', now), { ttl: 900 }, 'remaining lifetime');
  assertEquals(pushDeliveryPolicy('invitation_window', '2026-10-01T20:00:00Z', now), { ttl: 0 }, 'expiry boundary');
  assertEquals(pushDeliveryPolicy('invitation_window', '2026-10-02T20:00:00Z', now), { ttl: 14_400 }, 'maximum cap');
  assertEquals(pushDeliveryPolicy('admin_invitation_yes'), {}, 'admin yes alert keeps the default');
});
