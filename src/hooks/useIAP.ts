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
      const offering = offerings.all['premium'] ?? offerings.current;
      const pkg = offering?.availablePackages[0];
      if (!pkg) {
        setIapError('no_offerings');
        return false;
      }
      await Purchases.purchasePackage(pkg);
      return true;
    } catch (err: unknown) {
      const rcErr = err as { userCancelled?: boolean; message?: string };
      if (!rcErr.userCancelled) {
        console.error('[useIAP] premium purchase failed:', err);
        setIapError(rcErr.message ?? 'purchase_failed');
      }
      return false;
    } finally {
      setPurchasing(false);
    }
  }

  async function purchaseEssential(): Promise<boolean> {
    setPurchasing(true);
    setIapError(null);
    try {
      const offerings = await Purchases.getOfferings();
      const offering = offerings.all['essential'] ?? offerings.current;
      const pkg = offering?.availablePackages[0];
      if (!pkg) {
        setIapError('no_offerings');
        return false;
      }
      await Purchases.purchasePackage(pkg);
      return true;
    } catch (err: unknown) {
      const rcErr = err as { userCancelled?: boolean; message?: string };
      if (!rcErr.userCancelled) {
        console.error('[useIAP] essential purchase failed:', err);
        setIapError(rcErr.message ?? 'purchase_failed');
      }
      return false;
    } finally {
      setPurchasing(false);
    }
  }

  return { purchasePremium, purchaseEssential, purchasing, iapError };
}
