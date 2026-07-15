import Purchases, { type PurchasesPackage } from 'react-native-purchases';
import { RC_API_KEY as revenueCatPublicKey } from '../config';

let configured = false;
let identityQueue: Promise<void> = Promise.resolve();

function ensureConfigured() {
  if (configured) return;
  if (!revenueCatPublicKey) {
    throw new Error('RevenueCat is not configured for this platform');
  }
  Purchases.configure({ apiKey: revenueCatPublicKey });
  configured = true;
}

function serializeIdentity<T>(operation: () => Promise<T>): Promise<T> {
  const result = identityQueue.catch(() => undefined).then(operation);
  identityQueue = result.then(() => undefined, () => undefined);
  return result;
}

/** Configure RevenueCat and finish customer identification before entitlement reads. */
export function configureRevenueCat(userId?: string): Promise<boolean> {
  return serializeIdentity(async () => {
    try {
      ensureConfigured();
      if (userId) {
        const currentUserId = await Purchases.getAppUserID();
        if (currentUserId !== userId) {
          if (!currentUserId.startsWith('$RCAnonymousID:')) await Purchases.logOut();
          await Purchases.logIn(userId);
        }
      }
      return true;
    } catch (err) {
      console.warn('[RevenueCat] configure/login failed:', err);
      return false;
    }
  });
}

/** Prevent one Supabase account from inheriting another account's RC identity. */
export function resetRevenueCatUser(): Promise<void> {
  return serializeIdentity(async () => {
    try {
      ensureConfigured();
      const currentUserId = await Purchases.getAppUserID();
      if (!currentUserId.startsWith('$RCAnonymousID:')) await Purchases.logOut();
    } catch (err) {
      console.warn('[RevenueCat] logOut failed:', err);
    }
  });
}

export function purchaseRevenueCatPackage(pkg: PurchasesPackage) {
  return serializeIdentity(() => Purchases.purchasePackage(pkg));
}

export function getActiveRevenueCatTier(): Promise<'premium' | 'essential' | null> {
  return serializeIdentity(async () => {
    try {
      const info = await Purchases.getCustomerInfo();
      if (info.entitlements.active.premium) return 'premium';
      if (info.entitlements.active.essential) return 'essential';
      return null;
    } catch {
      return null;
    }
  });
}

export async function getIsActivePremium(): Promise<boolean> {
  return (await getActiveRevenueCatTier()) === 'premium';
}

export async function getIsActiveEssential(): Promise<boolean> {
  return (await getActiveRevenueCatTier()) === 'essential';
}

/** Restore purchases only after all pending identity changes finish. */
export function restorePurchases(): Promise<boolean> {
  return serializeIdentity(async () => {
    const info = await Purchases.restorePurchases();
    return Boolean(info.entitlements.active.premium || info.entitlements.active.essential);
  });
}
