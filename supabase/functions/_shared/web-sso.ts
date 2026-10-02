// Shared by validate-sso-token: the website's server-to-server SSO exchange.
// The website (soberhelpline.com) calls with the MEMBERSHIP_SYNC_SECRET header
// to learn who the app user is and whether they're a paying member, so it can
// open a real website session and gate member pages on actual membership.

export type WebSsoTier = 'premier' | 'essential' | 'free';

/** Constant-time comparison so the shared secret can't be probed by timing. */
export function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = new TextEncoder().encode(provided);
  const b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * Premier (or an active provider org) outranks Essential; anyone else is free.
 * `member` is what the website's member pages and the $25 coaching discount use.
 */
export function webSsoTier(premierAccess: boolean, memberAccess: boolean): { tier: WebSsoTier; member: boolean } {
  if (premierAccess) return { tier: 'premier', member: true };
  if (memberAccess) return { tier: 'essential', member: true };
  return { tier: 'free', member: false };
}
