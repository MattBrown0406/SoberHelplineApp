export const PRACTICE_PUSH_TTL_SECONDS = 4 * 60 * 60;

/** Provider-level delivery policy by outbox kind. */
export function pushDeliveryPolicy(kind: string): { ttl?: number } {
  return kind === 'practice_incoming'
    ? { ttl: PRACTICE_PUSH_TTL_SECONDS }
    : {};
}
