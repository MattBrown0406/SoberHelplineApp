// RevenueCat REST v1 customer-info-model: entitlements have no environment flag.
// Match the product's latest subscription purchase_date before trusting its
// is_sandbox/store/refunded_at. These are the two products in src/hooks/useIAP.ts.
const PRODUCTS = {
  essential: "sh_essential_monthly",
  premium: "sh_premium_monthly",
} as const;
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid RevenueCat response");
  }
  return value as Record<string, unknown>;
}
function timestamp(value: unknown): number {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error("invalid RevenueCat date");
  }
  return Date.parse(value);
}
function expiry(value: Record<string, unknown>): number {
  // Monthly products must have an expiry; never turn missing fields into lifetime access.
  const expires = timestamp(value.expires_date);
  return value.grace_period_expires_date == null
    ? expires
    : Math.max(expires, timestamp(value.grace_period_expires_date));
}
export function sandboxAllowed(
  accountId: string,
  email: string | undefined,
  emailConfirmed: boolean,
  accountAllowlist: string,
): boolean {
  // Explicitly documented sandbox reviewer (docs/appstore-review-notes.md).
  // Other TestFlight testers must be provisioned by operators, not client flags.
  return (emailConfirmed &&
    email?.toLowerCase() === "appreview@soberhelpline.com") ||
    accountAllowlist.split(",").map((id) => id.trim()).filter(Boolean).includes(
      accountId,
    );
}
export function revenueCatMirror(
  body: unknown,
  allowSandbox: boolean,
  now = Date.now(),
): Record<string, string> {
  const subscriber = object(object(body).subscriber);
  const entitlements = object(subscriber.entitlements);
  const subscriptions = object(subscriber.subscriptions);
  const mirrored: Record<string, string> = {};
  for (const [tier, product] of Object.entries(PRODUCTS)) {
    if (!(tier in entitlements)) continue;
    const entitlement = object(entitlements[tier]);
    if (entitlement.product_identifier !== product) continue;
    const entExpiry = expiry(entitlement);
    if (entExpiry <= now) continue;
    if (!(product in subscriptions)) continue;
    const transaction = object(subscriptions[product]);
    if (
      timestamp(transaction.purchase_date) !==
        timestamp(entitlement.purchase_date)
    ) continue;
    if (
      transaction.store !== "app_store" && transaction.store !== "play_store"
    ) continue;
    if (typeof transaction.is_sandbox !== "boolean") {
      throw new Error("missing RevenueCat environment");
    }
    if (transaction.is_sandbox && !allowSandbox) continue;
    if (transaction.refunded_at != null) continue;
    const expires = Math.min(entExpiry, expiry(transaction));
    if (expires > now) mirrored[tier] = new Date(expires).toISOString();
  }
  return mirrored;
}
