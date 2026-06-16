/**
 * App-level configuration.
 * COACHING_PAYMENT_URL: PayPal checkout for 1:1 coaching ($150/hr).
 * Permitted outside IAP under App Store guideline 3.1.3(d) — real-time
 * person-to-person services. Set EXPO_PUBLIC_COACHING_PAYMENT_URL in .env
 * (and EAS env) to the real PayPal link.
 */
export const COACHING_RATE_LABEL = '$150';

export const RC_API_KEY =
  process.env.EXPO_PUBLIC_RC_API_KEY ?? 'appl_sTcxKuHizcswwnnOgGMcFSlwFsa';

export const RC_PREMIUM_ENTITLEMENT = 'premium';

export const COACHING_PAYMENT_URL =
  process.env.EXPO_PUBLIC_COACHING_PAYMENT_URL ??
  'https://www.paypal.com/paypalme/REPLACE_ME/150';

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

// Subscription upgrade page — placeholder until StoreKit IAP is wired.
// The app shows an in-app upgrade sheet; this URL is kept for future web use.
export const SUBSCRIBE_URL =
  process.env.EXPO_PUBLIC_SUBSCRIBE_URL ?? 'https://soberhelpline.com/subscribe';

// Provider directory — used for interventionist referral CTAs.
// The app shows a built-in provider card; this URL is kept for future web use.
export const PROVIDERS_URL =
  process.env.EXPO_PUBLIC_PROVIDERS_URL ?? 'https://soberhelpline.com/providers';

// Email address to contact for premium upgrades and provider inquiries.
export const UPGRADE_EMAIL =
  process.env.EXPO_PUBLIC_UPGRADE_EMAIL ?? 'matt@freedominterventions.com';

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
