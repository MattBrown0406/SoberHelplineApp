import { appPathForIncomingUrl } from '../src/lib/universalLinks';
import { setPendingDeepLink } from '../src/lib/pendingDeepLink';

/**
 * expo-router calls this for every URL the system hands the app (cold start
 * and while running). soberhelpline.com/app links (and sober-helpline://app/…)
 * become a fixed in-app path; every other URL — including the custom scheme's
 * other paths — is returned unchanged so expo-router handles it as before.
 * Push notification taps don't come through here (they route in
 * src/lib/pushRouting.ts via usePushNotifications).
 */
// expo-router parses an incoming URL's query with query-string →
// decode-uri-component 0.2, which is exponential on malformed %-escapes
// (GHSA-qr28-fpjm-wq7f; the fixed 0.5 is ESM-only). We never send such a URL,
// so a crafted one just opens the app at its start instead of freezing it.
const MAX_INCOMING_URL = 4096;
function safeForRouter(path: string): boolean {
  if (path.length > MAX_INCOMING_URL) return false;
  try {
    decodeURIComponent(path);
    return true;
  } catch {
    return false;
  }
}

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (!safeForRouter(path)) return '/';
  try {
    const appPath = appPathForIncomingUrl(path);
    if (appPath === null) return path;
    // Remembered so a signed-out member lands here after signing in.
    setPendingDeepLink(appPath);
    return appPath;
  } catch {
    return path;
  }
}
