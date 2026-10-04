/**
 * Where a member's Essential/Premier comes from. soberhelpline.com members get
 * app access without an App Store subscription: sync-web-membership writes
 * source 'web' rows, and membership-import writes source 'scholarship' rows
 * with raw->>'granted_by' = 'soberhelpline_website_membership'. Their billing
 * lives on the website, so Settings says so in plain text (App Store 3.1.1:
 * no link or button to manage or buy it there).
 */
export const WEBSITE_MEMBERSHIP_GRANT = 'soberhelpline_website_membership';

export interface MembershipEntitlementRow {
  source: string | null;
  tier: string | null;
  expires_at: string | null;
  /** raw->>'granted_by' */
  granted_by?: string | null;
}

const TIER_RANK: Readonly<Record<string, number>> = Object.freeze({ essential: 1, premium: 2 });

export function isWebsiteEntitlement(row: MembershipEntitlementRow): boolean {
  return row.source === 'web' || (row.source === 'scholarship' && row.granted_by === WEBSITE_MEMBERSHIP_GRANT);
}

function isActive(row: MembershipEntitlementRow, now: Date): boolean {
  if (!row.expires_at) return true;
  const expires = Date.parse(row.expires_at);
  return Number.isFinite(expires) && expires >= now.getTime();
}

/**
 * True when an active soberhelpline.com membership provides the tier the app
 * is showing (`currentTier`, from AccountContext). A higher tier from
 * elsewhere (e.g. an App Store Premier) means the membership is not the
 * website's to describe.
 */
export function isWebsiteMembership(
  rows: readonly MembershipEntitlementRow[],
  currentTier: 'essential' | 'premium',
  now = new Date(),
): boolean {
  const websiteRank = Math.max(
    0,
    ...rows
      .filter((row) => row.tier !== null && TIER_RANK[row.tier] !== undefined && isActive(row, now) && isWebsiteEntitlement(row))
      .map((row) => TIER_RANK[row.tier as string]),
  );
  return websiteRank > 0 && websiteRank >= TIER_RANK[currentTier];
}
