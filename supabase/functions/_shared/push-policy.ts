export const PRACTICE_PUSH_TTL_SECONDS = 4 * 60 * 60;

/**
 * "Tonight may be a window" is only useful this evening: a delivery delayed
 * by an offline phone must not arrive the next morning.
 */
export const INVITATION_WINDOW_PUSH_TTL_SECONDS = 4 * 60 * 60;

/** Provider-level delivery policy by outbox kind. */
export function pushDeliveryPolicy(kind: string): { ttl?: number } {
  if (kind === 'practice_incoming') return { ttl: PRACTICE_PUSH_TTL_SECONDS };
  if (kind === 'invitation_window') return { ttl: INVITATION_WINDOW_PUSH_TTL_SECONDS };
  return {};
}
