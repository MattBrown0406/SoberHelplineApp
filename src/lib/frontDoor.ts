/**
 * The front door: which screen a signed-out person sees first, and how the
 * "Confirm your email" step behaves after sign-up. Pure decisions only; the
 * device flag lives in frontDoorStore and the screens in app/(auth).
 */

// ── Which screen first ───────────────────────────────────────────────────────

/**
 * Device storage key for "someone has signed in on this phone before". It holds
 * only '1': no account id, email or anything else about who it was, so it stays
 * after sign-out and account deletion (a returning person still lands on sign-in).
 */
export const SIGNED_IN_BEFORE_KEY = '@sh:front-door:signed-in-before';

export type FrontDoorRoute = '/(auth)/sign-up' | '/(auth)/sign-in';

/** What the device flag says. Anything but the stored '1' (or an unreadable store) is "never". */
export function parseSignedInBefore(stored: string | null | undefined): boolean {
  return stored === '1';
}

/**
 * Phones that had the app before this flag existed: a finished onboarding on
 * the device means someone signed in here, so they are not sent to sign-up.
 */
export function hasEarlierSignInTrace(deviceKeys: readonly string[]): boolean {
  return deviceKeys.some((key) => key === '@sh:onboarded' || key.startsWith('@sh:onboarded:'));
}

/**
 * A brand-new person opens on creating an account; once any account has signed
 * in on the device (including this session, before the flag reaches storage),
 * signed-out people land on sign-in: after sign-out, account deletion, or an
 * expired session.
 */
export function frontDoorRoute(input: { signedInBefore: boolean; signedInThisSession: boolean }): FrontDoorRoute {
  return input.signedInBefore || input.signedInThisSession ? '/(auth)/sign-in' : '/(auth)/sign-up';
}

// ── Confirm your email ───────────────────────────────────────────────────────

/**
 * Where the link in the confirmation email lands, for sign-up and for "Send
 * the email again" alike. Supabase Edge Functions serve HTML as plain text on
 * the default supabase.co domain, so it is a normal soberhelpline.com page
 * (must be in the project's auth redirect allow-list).
 */
export const SIGN_UP_CONFIRM_REDIRECT_URL = 'https://soberhelpline.com/app-confirmed.html';

/** "Send the email again" waits this long after the last email (Supabase limits it the same way). */
export const RESEND_COOLDOWN_SECONDS = 60;

/** Whole seconds left before the email can be sent again; 0 when it can. */
export function resendSecondsLeft(lastSentAtMs: number | null, nowMs: number): number {
  if (lastSentAtMs === null || !Number.isFinite(lastSentAtMs)) return 0;
  const elapsedMs = nowMs - lastSentAtMs;
  // A clock that moved backwards must not lock the button for longer than one cooldown.
  if (elapsedMs < 0) return RESEND_COOLDOWN_SECONDS;
  return Math.max(0, Math.ceil(RESEND_COOLDOWN_SECONDS - elapsedMs / 1000));
}

/**
 * The password she typed is kept in memory only while the confirm step is on
 * screen. Away from the app for longer than this, it is forgotten and she
 * signs in normally instead.
 */
export const PASSWORD_MEMORY_BACKGROUND_LIMIT_MS = 5 * 60 * 1000;

/** True when the app was in the background long enough that the password must be forgotten. */
export function shouldForgetPassword(backgroundedAtMs: number | null, nowMs: number): boolean {
  if (backgroundedAtMs === null) return false;
  const awayMs = nowMs - backgroundedAtMs;
  // An unreadable clock fails closed: forget.
  if (!Number.isFinite(awayMs) || awayMs < 0) return true;
  return awayMs > PASSWORD_MEMORY_BACKGROUND_LIMIT_MS;
}

/** Automatic tries are never closer together than this, however fast she switches apps. */
export const AUTO_TRY_MIN_GAP_MS = 5_000;

/**
 * Whether to try the sign-in by itself when the app comes back to the front:
 * once per real return from the background (a system sheet or the app switcher
 * passing over is not a return), never while a try is already running, never
 * without the password, and never in a loop.
 */
export function shouldAutoTryOnReturn(input: {
  /** The app state it is changing to. */
  nextState: string;
  /** The app went to the background since it was last active. */
  wasBackgrounded: boolean;
  /** A sign-in or resend is already running. */
  busy: boolean;
  /** The password is still held in memory. */
  hasPassword: boolean;
  /** When the last automatic try started, if any. */
  lastAutoTryAtMs: number | null;
  nowMs: number;
}): boolean {
  if (input.nextState !== 'active' || !input.wasBackgrounded) return false;
  if (input.busy || !input.hasPassword) return false;
  if (input.lastAutoTryAtMs !== null) {
    const sinceLast = input.nowMs - input.lastAutoTryAtMs;
    if (!Number.isFinite(sinceLast) || (sinceLast >= 0 && sinceLast < AUTO_TRY_MIN_GAP_MS)) return false;
  }
  return true;
}

export type ConfirmSignInOutcome = 'signed-in' | 'not-confirmed' | 'wrong-password' | 'failed';

/**
 * Reads the answer to the sign-in tried from the confirm step. "Not confirmed
 * yet" is expected and calm; a wrong password means the address already had an
 * account (sign-up does not reveal that); anything else is a connection problem.
 */
export function confirmSignInOutcome(result: {
  error: { code?: string | null; message?: string | null; status?: number | null } | null | undefined;
  hasSession: boolean;
}): ConfirmSignInOutcome {
  const error = result.error;
  if (!error) return result.hasSession ? 'signed-in' : 'failed';
  const message = (error.message ?? '').toLowerCase();
  if (error.code === 'email_not_confirmed' || message.includes('not confirmed')) return 'not-confirmed';
  if (error.code === 'invalid_credentials' || message.includes('invalid')) return 'wrong-password';
  return 'failed';
}
