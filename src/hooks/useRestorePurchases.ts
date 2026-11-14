import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccount } from '../contexts/AccountContext';
import { supabase } from '../lib/supabase';
import { getActiveRevenueCatTier, restorePurchases } from '../lib/revenueCat';
import { recordVerifiedPurchase, withTimeoutFallback } from '../lib/authBootstrap';
import { appAlert } from '../lib/appAlert';

/**
 * "Restore Purchases", shared by Settings and the plans screen so both do
 * exactly the same thing: ask the store, unlock from its answer, let the
 * server mirror catch up, then say what was found.
 */
export function useRestorePurchases(): { restoring: boolean; handleRestore: () => Promise<void> } {
  const { user, accountState, refreshAccount } = useAccount();
  const { t } = useTranslation('settings');
  const [restoring, setRestoring] = useState(false);
  // Set when a restore finishes. The message is chosen on the next render, once
  // the refreshed plan (App Store or website membership) is the one on screen.
  const [restoreOutcome, setRestoreOutcome] = useState<{ storeRestored: boolean } | null>(null);

  // After Restore: the store found a purchase, or the refresh found a plan from
  // anywhere else (a website membership), or the account is still free.
  useEffect(() => {
    if (!restoreOutcome) return;
    setRestoreOutcome(null);
    const planActive = accountState === 'direct-essential' || accountState === 'direct-premium';
    if (restoreOutcome.storeRestored) {
      appAlert(t('membership.restoreSuccessTitle'), t('membership.restoreSuccessBody'));
    } else if (planActive) {
      appAlert(t('membership.restoreActiveTitle'), t('membership.restoreActiveBody'));
    } else {
      appAlert(t('membership.restoreNoneTitle'), t('membership.restoreNoneBody'));
    }
  }, [restoreOutcome, accountState, t]);

  async function handleRestore() {
    if (restoring) return;
    setRestoring(true);
    try {
      const hasEntitlement = await restorePurchases();
      if (hasEntitlement && user) {
        // Same as a purchase: unlock from the store's answer now, and give the server
        // mirror (RevenueCat → entitlements) time to catch up before re-reading.
        const tier = await getActiveRevenueCatTier().catch(() => null);
        if (tier) recordVerifiedPurchase(user.id, tier);
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await withTimeoutFallback(
            Promise.resolve(supabase.functions.invoke('sync-iap-entitlements', {
              headers: { Authorization: `Bearer ${session.access_token}` },
            })).then(() => undefined),
            10_000,
            undefined,
          );
        }
      }
      await refreshAccount();
      setRestoreOutcome({ storeRestored: hasEntitlement });
    } catch {
      appAlert(t('membership.restoreErrorTitle'), t('membership.restoreErrorBody'));
    } finally {
      setRestoring(false);
    }
  }

  return { restoring, handleRestore };
}
