/**
 * The last app link (universal link) that arrived, kept briefly so a member
 * who was signed out lands on it after signing in instead of on Today.
 *
 * The root layout consumes it after sign-in and clears it as soon as a signed-in
 * member is in the app (the link already navigated there). It expires on its
 * own so a stale link never redirects a later sign-in.
 */
export const PENDING_DEEP_LINK_TTL_MS = 10 * 60_000;

let pending: { path: string; at: number } | null = null;
const listeners = new Set<() => void>();

// Deferred: expo-router may resolve the launch URL while React is rendering,
// and a listener's state update must not run inside another component's render.
function notify(): void {
  void Promise.resolve().then(() => {
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch {
        // A listener must never break link handling.
      }
    }
  });
}

export function setPendingDeepLink(path: string, now = Date.now()): void {
  pending = { path, at: now };
  notify();
}

/** The pending link if it is still fresh, without consuming it. */
export function peekPendingDeepLink(now = Date.now()): string | null {
  if (!pending) return null;
  if (now - pending.at > PENDING_DEEP_LINK_TTL_MS || now < pending.at - 60_000) {
    pending = null;
    return null;
  }
  return pending.path;
}

/** Consume the pending link (null when there is none or it expired). */
export function takePendingDeepLink(now = Date.now()): string | null {
  const path = peekPendingDeepLink(now);
  pending = null;
  return path;
}

export function clearPendingDeepLink(): void {
  pending = null;
}

export function subscribePendingDeepLink(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
