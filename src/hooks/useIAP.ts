import { useState } from 'react';
import Purchases, { type PurchasesOfferings, type PurchasesPackage } from 'react-native-purchases';

/**
 * Resolve the StoreKit package for a tier across any RevenueCat offering layout.
 * Works whether the dashboard exposes one offering per tier ("essential",
 * "premium") or a single "current" offering containing both products.
 */
function findPackage(offerings: PurchasesOfferings, tier: 'essential' | 'premium'): PurchasesPackage | null {
  // 1. Dedicated offering named after the tier.
  const named = offerings.all[tier]?.availablePackages[0];
  if (named) return named;

  // 2. Any package whose product identifier names the tier (e.g. com.soberhelpline.essential.monthly).
  for (const offering of Object.values(offerings.all)) {
    const match = offering.availablePackages.find((p) =>
      p.product.identifier.toLowerCase().includes(tier),
    );
    if (match) return match;
  }

  // 3. Fall back to the current offering's first package.
  return offerings.current?.availablePackages[0] ?? null;
}

export function useIAP() {
  const [purchasing, setPurchasing] = useState(false);
  const [iapError, setIapError] = useState<string | null>(null);

  async function purchaseTier(tier: 'essential' | 'premium'): Promise<boolean> {
    setPurchasing(true);
    setIapError(null);
    try {
      const offerings = await Purchases.getOfferings();
      const pkg = findPackage(offerings, tier);
      if (!pkg) {
        setIapError('no_offerings');
        return false;
      }
      await Purchases.purchasePackage(pkg);
      return true;
    } catch (err: unknown) {
      const rcErr = err as { userCancelled?: boolean; message?: string };
      if (!rcErr.userCancelled) {
        console.error(`[useIAP] ${tier} purchase failed:`, err);
        setIapError(rcErr.message ?? 'purchase_failed');
      }
      return false;
    } finally {
      setPurchasing(false);
    }
  }

  return {
    purchasePremium: () => purchaseTier('premium'),
    purchaseEssential: () => purchaseTier('essential'),
    purchasing,
    iapError,
  };
}
