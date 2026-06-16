import { useState } from 'react';
import Purchases from 'react-native-purchases';

export function useIAP() {
  const [purchasing, setPurchasing] = useState(false);
  const [iapError, setIapError] = useState<string | null>(null);

  async function purchasePremium(): Promise<boolean> {
    setPurchasing(true);
    setIapError(null);
    try {
      const offerings = await Purchases.getOfferings();
      const pkg = offerings.current?.availablePackages[0];
      if (!pkg) {
        setIapError('no_offerings');
        return false;
      }
      await Purchases.purchasePackage(pkg);
      return true;
    } catch (err: unknown) {
      const rcErr = err as { userCancelled?: boolean; message?: string };
      if (!rcErr.userCancelled) {
        console.error('[useIAP] purchase failed:', err);
        setIapError(rcErr.message ?? 'purchase_failed');
      }
      return false;
    } finally {
      setPurchasing(false);
    }
  }

  return { purchasePremium, purchasing, iapError };
}
