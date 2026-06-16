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
