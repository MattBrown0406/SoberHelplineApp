/**
 * soberhelpline.com shares Sober Helpline accounts with the app. Pages the app
 * opens there carry a single-use `sso_token` so the member arrives signed in
 * (the website exchanges it with validate-sso-token, then strips it).
 *
 * Only `/app` and `/app/*` on this domain open the app (universal links); the
 * app itself only ever opens the pages below, so it never sends a member back
 * into itself by accident.
 *
 * Every soberhelpline.com page the app opens also says where it came from:
 * - `from_app=1`  — the website hides membership purchase links (memberships are
 *   sold in the app only through Apple in-app purchase; guideline 3.1.1).
 * - `app_links=1` — the website may show "Return to the app" buttons. Only this
 *   build and later understand those links, so older builds never send it.
 */
export const WEBSITE_ORIGIN = 'https://soberhelpline.com';

export const WEBSITE_PATHS = Object.freeze({
  /** Members-only family forum ("more groups and topics"). */
  familyForum: '/family-forum',
  /** Members-only family education library. */
  familyEducation: '/family-education',
  /** Members-only Family Squares recordings. */
  zoomRecordings: '/zoom-recordings',
  /** Real coaching time slots + PayPal checkout (members are charged $125). */
  bookConsultation: '/book-consultation',
});

/** Query parameters added to every soberhelpline.com page the app opens. */
export const APP_CONTEXT_PARAMS: readonly (readonly [string, string])[] = Object.freeze([
  Object.freeze(['from_app', '1'] as const),
  Object.freeze(['app_links', '1'] as const),
]);

const WEBSITE_URL_PATTERN = /^https:\/\/(www\.)?soberhelpline\.com(?=[/?#]|$)/i;

/** A same-site path (never `//host` or a full URL, which could leave the site). */
function safePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || /[\s\\]/.test(trimmed)) return '/';
  return trimmed;
}

/** Adds `params` to `url` (before any `#fragment`, after any existing query), skipping keys already present. */
function appendParams(url: string, params: readonly (readonly [string, string])[]): string {
  const hashIndex = url.indexOf('#');
  let base = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
  const queryIndex = base.indexOf('?');
  const existing = new Set(
    (queryIndex === -1 ? '' : base.slice(queryIndex + 1))
      .split('&')
      .filter(Boolean)
      .map((pair) => pair.split('=')[0]),
  );
  for (const [key, value] of params) {
    if (existing.has(key)) continue;
    base += `${base.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;
    existing.add(key);
  }
  return `${base}${hash}`;
}

/** True for an https://soberhelpline.com (or www.) URL. */
export function isWebsiteUrl(url: string): boolean {
  return WEBSITE_URL_PATTERN.test(url.trim());
}

/**
 * Marks a soberhelpline.com URL as opened from the app (`from_app=1`,
 * `app_links=1`). Any other URL is returned unchanged.
 */
export function withAppContext(url: string): string {
  const trimmed = url.trim();
  return isWebsiteUrl(trimmed) ? appendParams(trimmed, APP_CONTEXT_PARAMS) : url;
}

/**
 * The website URL for `path`, marked as opened from the app, with the sign-in
 * token appended when there is one.
 */
export function websiteUrl(path: string, ssoToken?: string | null): string {
  const params: (readonly [string, string])[] = [...APP_CONTEXT_PARAMS];
  if (ssoToken) params.push(['sso_token', ssoToken]);
  return appendParams(`${WEBSITE_ORIGIN}${safePath(path)}`, params);
}
