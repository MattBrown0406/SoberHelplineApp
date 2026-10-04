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
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
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
