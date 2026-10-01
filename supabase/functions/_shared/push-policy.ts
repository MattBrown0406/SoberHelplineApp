export const PRACTICE_PUSH_TTL_SECONDS = 4 * 60 * 60;

/**
 * "Tonight may be a window" is only useful this evening: a delivery delayed
 * by an offline phone must not arrive the next morning.
 */
export const INVITATION_WINDOW_PUSH_TTL_SECONDS = 4 * 60 * 60;

/** Provider-level delivery policy by outbox kind. */
export function pushDeliveryPolicy(kind: string, expiresAt?: string | null, now = Date.now()): { ttl?: number } {
  if (kind === 'practice_incoming') return { ttl: PRACTICE_PUSH_TTL_SECONDS };
  if (kind === 'invitation_window') {
    // Missing/invalid expiry fails closed; retries never restart the window.
    const expiry = expiresAt ? Date.parse(expiresAt) : NaN;
    return { ttl: Number.isFinite(expiry)
      ? Math.max(0, Math.min(INVITATION_WINDOW_PUSH_TTL_SECONDS, Math.floor((expiry - now) / 1000)))
      : 0 };
  }
  return {};
}
