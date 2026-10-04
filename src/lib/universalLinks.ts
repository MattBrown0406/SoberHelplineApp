/**
 * Universal links from soberhelpline.com into the app (contract §A).
 *
 * Only https://soberhelpline.com/app and /app/* open the app (the website's
 * apple-app-site-association lists exactly those). Each known path maps to a
 * fixed in-app screen; an unknown /app/* path opens home. The same paths are
 * accepted on the custom scheme as `sober-helpline://app/...` so a page on
 * soberhelpline.com can hand the member back to the app (Safari keeps a
 * same-domain universal link in the browser).
 *
 * Anything else — other hosts, other soberhelpline.com paths, every other
 * `sober-helpline://` link — is not ours: `appPathForIncomingUrl` returns null
 * and expo-router handles the URL exactly as before. Query strings and
 * fragments on incoming links are ignored; nothing from the URL is passed on.
 *
 * Pure (no React Native imports): it runs inside expo-router's
 * `redirectSystemPath` and in unit tests.
 */

/** In-app destinations, as expo-router URL paths (route groups omitted). */
export const APP_LINK_HOME = '/';

const APP_LINK_ROUTES: Readonly<Record<string, string>> = Object.freeze({
  '': APP_LINK_HOME,
  'family-squares': '/support?focus=family-squares',
  coaching: '/book-coaching',
  'coaching/booked': '/book-coaching?booked=1',
  'plan-review': '/crisis-mode?focus=session',
  chat: '/chat',
  learn: '/learn',
  settings: '/settings',
});

const WEBSITE_HOSTS = new Set(['soberhelpline.com', 'www.soberhelpline.com']);
const APP_SCHEME = 'sober-helpline';

// scheme://host/path?query#fragment — parsed by hand: React Native's URL
// polyfill does not implement hostname/pathname.
const URL_PATTERN = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)/i;

/** The part of `pathname` after the `/app` namespace, or null when outside it. */
function appNamespaceRemainder(pathname: string): string | null {
  const path = pathname.replace(/\/{2,}/g, '/');
  if (path !== '/app' && !path.startsWith('/app/')) return null;
  return path.slice('/app'.length);
}

function destinationFor(remainder: string): string {
  let key = remainder.replace(/^\/+|\/+$/g, '').toLowerCase();
  try {
    key = decodeURIComponent(key);
  } catch {
    return APP_LINK_HOME;
  }
  return Object.prototype.hasOwnProperty.call(APP_LINK_ROUTES, key) ? APP_LINK_ROUTES[key] : APP_LINK_HOME;
}

/**
 * The in-app path for an incoming URL, or null when the URL is not an
 * app link (leave it alone).
 */
export function appPathForIncomingUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const match = URL_PATTERN.exec(url.trim());
  if (!match) return null;
  const scheme = match[1].toLowerCase();
  const host = match[2].toLowerCase().replace(/:443$/, '');
  const pathname = match[3] || '/';

  if (scheme === 'https' && WEBSITE_HOSTS.has(host)) {
    const remainder = appNamespaceRemainder(pathname);
    return remainder === null ? null : destinationFor(remainder);
  }

  if (scheme === APP_SCHEME) {
    // sober-helpline://app/coaching (host "app") or sober-helpline:///app/coaching.
    if (host === 'app') return destinationFor(pathname);
    if (host === '') {
      const remainder = appNamespaceRemainder(pathname);
      return remainder === null ? null : destinationFor(remainder);
    }
  }

  return null;
}
