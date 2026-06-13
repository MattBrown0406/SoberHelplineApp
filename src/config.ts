/**
 * App-level configuration.
 * COACHING_PAYMENT_URL: PayPal checkout for 1:1 coaching ($150/hr).
 * Permitted outside IAP under App Store guideline 3.1.3(d) — real-time
 * person-to-person services. Set EXPO_PUBLIC_COACHING_PAYMENT_URL in .env
 * (and EAS env) to the real PayPal link.
 */
export const COACHING_RATE_LABEL = '$150';

export const COACHING_PAYMENT_URL =
  process.env.EXPO_PUBLIC_COACHING_PAYMENT_URL ??
  'https://www.paypal.com/paypalme/REPLACE_ME/150';

// Where group Join taps land when a group has no specific Zoom link yet,
// and the destination for "more groups & topics."
export const GROUPS_URL =
  process.env.EXPO_PUBLIC_GROUPS_URL ?? 'https://soberhelpline.com/family-forum';
