/**
 * Recovery meetings for families, offered after a hard check-in on Today.
 * The official meeting finders (checked 2026-11-24). Only the URLs and their
 * home domains live here; every word she reads is in today.json
 * (`fellowships.options.<key>`). Pure, so tests can import it.
 */
export const FELLOWSHIPS = ['alAnon', 'narAnon', 'aca', 'coda', 'pal'] as const;
export type Fellowship = (typeof FELLOWSHIPS)[number];

export const FELLOWSHIP_FINDERS: Readonly<Record<Fellowship, { url: string; domain: string }>> = Object.freeze({
  alAnon: { url: 'https://al-anon.org/al-anon-meetings/find-an-al-anon-meeting/', domain: 'al-anon.org' },
  narAnon: { url: 'https://nar-anon.org/find-a-meeting/', domain: 'nar-anon.org' },
  aca: { url: 'https://adultchildren.org/meeting-search/', domain: 'adultchildren.org' },
  coda: { url: 'https://coda.org/find-a-meeting/', domain: 'coda.org' },
  pal: { url: 'https://palgroup.org/meeting-finder/', domain: 'palgroup.org' },
});

export function isFellowship(value: unknown): value is Fellowship {
  return typeof value === 'string' && (FELLOWSHIPS as readonly string[]).includes(value);
}
