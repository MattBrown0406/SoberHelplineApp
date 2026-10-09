// Server-to-server calls between soberhelpline.com and the app backend carry
// the shared MEMBERSHIP_SYNC_SECRET in the x-membership-sync-secret header
// (set to the same value on both projects). These functions run with
// verify_jwt = false, so this check is their only gate.

import { secretMatches } from './web-sso.ts';

const headers = { 'Content-Type': 'application/json' };

/** null when the request may proceed; otherwise the response to return (405 / 401). */
export function requireSyncSecret(
  req: Request,
  expected: string | undefined = Deno.env.get('MEMBERSHIP_SYNC_SECRET'),
): Response | null {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers });
  }
  if (!expected) console.error('MEMBERSHIP_SYNC_SECRET is not configured');
  if (!secretMatches(req.headers.get('x-membership-sync-secret'), expected)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers });
  }
  return null;
}

/**
 * For the read-only bridge calls AyudaSobria.com (the Spanish site) also makes
 * (membership-export, validate-sso-token): the website's MEMBERSHIP_SYNC_SECRET or
 * AyudaSobria's own AYUDA_SYNC_SECRET. Kept separate so either site's secret can be
 * rotated alone, and so AyudaSobria can never call the write paths
 * (membership-import, Family Squares sync), which keep requireSyncSecret.
 */
export function requireSyncSecretOrAyuda(
  req: Request,
  website: string | undefined = Deno.env.get('MEMBERSHIP_SYNC_SECRET'),
  ayuda: string | undefined = Deno.env.get('AYUDA_SYNC_SECRET'),
): Response | null {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers });
  }
  const provided = req.headers.get('x-membership-sync-secret');
  if (secretMatches(provided, website) || secretMatches(provided, ayuda)) return null;
  return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers });
}
