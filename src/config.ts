import { Platform } from 'react-native';
import { websiteUrl } from './lib/websiteLinks';

/**
 * App-level configuration. No secrets here — only public client values that are
 * safe to ship in the bundle. Coaching prices live in src/lib/coachingPrice.ts
 * and soberhelpline.com paths in src/lib/websiteLinks.ts.
 */

// Public legal documents used by signup, settings, and every subscription surface.
// Opened from the app, so they carry the app context (no membership purchase links).
export const TERMS_OF_USE_URL = websiteUrl('/app-terms');
export const PRIVACY_POLICY_URL = websiteUrl('/privacy');

const RC_IOS_API_KEY =
  process.env.EXPO_PUBLIC_RC_IOS_API_KEY
  ?? process.env.EXPO_PUBLIC_RC_API_KEY
  ?? 'appl_sTcxKuHizcswwnnOgGMcFSlwFsa';
const RC_ANDROID_API_KEY = process.env.EXPO_PUBLIC_RC_ANDROID_API_KEY ?? '';
const RC_WEB_API_KEY = process.env.EXPO_PUBLIC_RC_WEB_API_KEY ?? '';

// RevenueCat keys are platform-specific. Passing the iOS public SDK key to the
// web SDK makes every browser session fail configuration before auth finishes.
export const RC_API_KEY = Platform.select({
  ios: RC_IOS_API_KEY,
  android: RC_ANDROID_API_KEY,
  web: RC_WEB_API_KEY,
  default: '',
}) ?? '';
export const SUBSCRIPTION_MANAGEMENT_URL = Platform.select({
  android: 'https://play.google.com/store/account/subscriptions',
  default: 'https://apps.apple.com/account/subscriptions',
}) as string;

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
