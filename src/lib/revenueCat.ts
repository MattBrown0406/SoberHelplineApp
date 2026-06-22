import Purchases from 'react-native-purchases';
import { RC_API_KEY } from '../config';

let configured = false;

export function configureRevenueCat(userId?: string) {
  try {
    if (!configured) {
      Purchases.configure({ apiKey: RC_API_KEY });
      configured = true;
    }
    if (userId) {
      void Purchases.logIn(userId).catch((err) =>
        console.warn('[RevenueCat] logIn failed:', err),
      );
    }
  } catch (err) {
    console.warn('[RevenueCat] configure failed:', err);
  }
}

export async function getIsActivePremium(): Promise<boolean> {
  try {
    const info = await Purchases.getCustomerInfo();
    return !!info.entitlements.active['premium'];
  } catch {
    return false;
  }
}

export async function getIsActiveEssential(): Promise<boolean> {
  try {
    const info = await Purchases.getCustomerInfo();
    return !!info.entitlements.active['essential'];
  } catch {
    return false;
  }
}

/**
 * Restores prior purchases (App Store guideline 3.1.1). Returns true if any
 * entitlement is active afterward. Throws on failure so the caller can surface
 * an error.
 */
export async function restorePurchases(): Promise<boolean> {
  const info = await Purchases.restorePurchases();
  return (
    !!info.entitlements.active['premium'] || !!info.entitlements.active['essential']
  );
}
