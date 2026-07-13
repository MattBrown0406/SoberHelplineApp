import { useEffect, useState } from 'react';
import Purchases, { type PurchasesOfferings, type PurchasesPackage } from 'react-native-purchases';
import { purchaseRevenueCatPackage } from '../lib/revenueCat';

export type SubscriptionTier = 'essential' | 'premium';

const PRODUCT_IDS: Record<SubscriptionTier, string> = {
  essential: 'sh_essential_monthly',
  premium: 'sh_premium_monthly',
};

/** Fail closed: a dashboard mistake must never make one tier purchase another. */
export function findPackage(offerings: PurchasesOfferings, tier: SubscriptionTier): PurchasesPackage | null {
  const expectedProductId = PRODUCT_IDS[tier];
  for (const offering of Object.values(offerings.all)) {
    const match = offering.availablePackages.find(
      (pkg) => pkg.product.identifier === expectedProductId,
    );
    if (match) return match;
  }
  return null;
}

export function useIAP() {
  const [purchasing, setPurchasing] = useState(false);
  const [iapError, setIapError] = useState<string | null>(null);
  const [prices, setPrices] = useState<Partial<Record<SubscriptionTier, string>>>({});

  useEffect(() => {
    let active = true;
    Purchases.getOfferings()
      .then((offerings) => {
        if (!active) return;
        const essential = findPackage(offerings, 'essential');
        const premium = findPackage(offerings, 'premium');
        setPrices({
          ...(essential ? { essential: essential.product.priceString } : {}),
          ...(premium ? { premium: premium.product.priceString } : {}),
        });
      })
      .catch(() => {
        // Purchase action retries offerings; static localized copy remains fallback.
      });
    return () => { active = false; };
  }, []);

  async function purchaseTier(tier: SubscriptionTier): Promise<boolean> {
    setPurchasing(true);
    setIapError(null);
    try {
      const offerings = await Purchases.getOfferings();
      const pkg = findPackage(offerings, tier);
      if (!pkg) {
        setIapError('tier_not_configured');
        return false;
      }

      const result = await purchaseRevenueCatPackage(pkg);
      if (!result.customerInfo.entitlements.active[tier]) {
        setIapError('entitlement_not_granted');
        return false;
      }
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
    prices,
  };
}
