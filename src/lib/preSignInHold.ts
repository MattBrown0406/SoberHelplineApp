/**
 * A signed-out person on a pre-sign-in screen stays on it when a link opens
 * the app.
 *
 * The page the confirmation email leads to has an "open the app" link
 * (`sober-helpline://`). A new person taps it with "Confirm your email" still
 * on screen. If that link were routed like any other, she would be taken off
 * the screen and sent to the front door again: the confirm step, and the
 * password it holds in memory to sign her in, would be thrown away. The same
 * goes for a half-typed sign-in or reset.
 *
 * So while the root layout says "signed out, and a pre-sign-in screen is in
 * front", a link that arrives does not navigate: it only brings the app
 * forward, and the confirm step is told so it can try its sign-in once, as it
 * does when the app returns from the background. (An app link is still
 * remembered by pendingDeepLink, so she lands on it after signing in.)
 *
 * Holds a yes/no only: nothing about who she is or what she typed. Pure (no
 * React Native imports): it runs inside expo-router's `redirectSystemPath`
 * and in unit tests.
 */
let held = false;
const listeners = new Set<() => void>();

/** Set by the root layout on every change of sign-in state or screen. */
export function setPreSignInHold(on: boolean): void {
  held = on;
}

export function preSignInHoldActive(): boolean {
  return held;
}

/**
 * What expo-router is given in place of the link while she is held: an empty
 * path, which it does not navigate to (it only acts on a non-empty one).
 */
export const STAY_ON_SCREEN = '';

/**
 * 'stay' when a link arrives while the app is running and she is held on a
 * pre-sign-in screen. A link that STARTS the app is always routed as before:
 * no screen is in front yet.
 */
export function incomingLinkAction(input: { initial: boolean; held: boolean }): 'stay' | 'route' {
  return !input.initial && input.held ? 'stay' : 'route';
}

/** A link brought the app forward while she was held. Told after the current work, never inside a render. */
export function noteLinkWhileHeld(): void {
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

export function subscribeLinkWhileHeld(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
