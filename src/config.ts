/**
 * App-level configuration. No secrets here — only public client values that are
 * safe to ship in the bundle.
 */
export const COACHING_RATE_LABEL = '$150';

export const RC_API_KEY =
  process.env.EXPO_PUBLIC_RC_API_KEY ?? 'appl_sTcxKuHizcswwnnOgGMcFSlwFsa';

// Where group Join taps land when a group has no specific Zoom link yet,
// and the destination for "more groups & topics."
export const GROUPS_URL =
  process.env.EXPO_PUBLIC_GROUPS_URL ?? 'https://soberhelpline.com/family-forum';

// LiveKit cloud endpoint — safe to ship in the client bundle (no secrets here).
export const LIVEKIT_URL =
  process.env.EXPO_PUBLIC_LIVEKIT_URL ?? 'wss://sober-helpline-75uawvbt.livekit.cloud';

// Supabase project URL (needed for edge-function fetches inside native screens).
export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';

// The single vetted provider shown in the in-app provider card.
// When a real provider directory API exists, remove this in favour of that.
export const FEATURED_PROVIDER = {
  name: 'Matt Brown',
  credential: 'CIP',
  credentialFull: 'Certified Intervention Professional',
  org: 'Sober Helpline',
  email: 'matt@freedominterventions.com',
  web: 'https://freedominterventions.com',
} as const;
