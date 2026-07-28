import {
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
