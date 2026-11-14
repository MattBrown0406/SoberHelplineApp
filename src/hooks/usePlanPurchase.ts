import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccount } from '../contexts/AccountContext';
import { supabase } from '../lib/supabase';
import { recordVerifiedPurchase, withTimeoutFallback } from '../lib/authBootstrap';
import { appAlert } from '../lib/appAlert';
import { logMembershipPath } from '../lib/funnel';
import type { PlanSource } from '../lib/membershipPath';
import { setReviewPromptPaywallVisible } from '../lib/reviewPrompt';
import { trialLabelKey } from '../lib/subscriptionTrial';
import { useIAP, type SubscriptionTier } from './useIAP';

/**
 * What the store offers right now: each plan's price, the free trial it will
 * actually give this member (if any), and the purchase calls. Prices and
 * trial eligibility come from StoreKit (useIAP), never from copy.
 */
export function usePlanOffers() {
  const { entitlements } = useAccount();
  const { t } = useTranslation('support');
  const { purchasePremium, purchaseEssential, purchasing, prices: subscriptionPrices, trials, retryPrices } = useIAP();
  const trialLabel = (tier: SubscriptionTier): string | null => {
    const trial = trials[tier];
    // A member who already has a plan is upgrading: Apple judges trial
    // eligibility per subscription group, so never promise her one.
    if (!trial || !subscriptionPrices[tier] || entitlements.canAccessGroups) return null;
    const { key, count } = trialLabelKey(trial);
    return t(key, { count });
  };
  return { subscriptionPrices, trialLabel, purchasing, retryPrices, purchasePremium, purchaseEssential };
}

export type PlanOffers = ReturnType<typeof usePlanOffers>;

/**
 * The one place a plan is bought. The plans screen owns the purchase sheet
 * (src/components/plans/UpgradeSheet); every "See plans" or "Upgrade" button
 * in the app opens that screen rather than starting a purchase of its own.
 *
 * `source` is the short label for where she came from; it goes on the
 * membership-path events and nowhere else.
 */
export function usePlanPurchase(source: PlanSource | 'unknown') {
  const { user, refreshAccount } = useAccount();
  const { t } = useTranslation('support');
  const { subscriptionPrices, trialLabel, purchasing, retryPrices, purchasePremium, purchaseEssential } = usePlanOffers();

  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeTier, setUpgradeTier] = useState<SubscriptionTier>('premium');

  useEffect(() => () => setReviewPromptPaywallVisible(false), []);

  const purchaseOwnerRef = useRef({ owner: user?.id, active: true, generation: 0 });
  if (purchaseOwnerRef.current.owner !== user?.id) {
    purchaseOwnerRef.current.active = false;
    purchaseOwnerRef.current = { owner: user?.id, active: true, generation: 0 };
  }
  const purchaseOwner = purchaseOwnerRef.current;
  useEffect(() => {
    purchaseOwner.active = true;
    purchaseOwner.generation += 1;
    return () => { purchaseOwner.active = false; purchaseOwner.generation += 1; };
  }, [purchaseOwner]);

  async function handlePurchase() {
    const generation = purchaseOwner.generation;
    const current = () => purchaseOwner.active && purchaseOwnerRef.current === purchaseOwner && generation === purchaseOwner.generation;
    if (!current() || !purchaseOwner.owner) return;
    if (!subscriptionPrices[upgradeTier]) return;
    const { data: { session: purchaseSession } } = await supabase.auth.getSession();
    if (!current() || !purchaseSession) return;
    const sameSession = async () => {
      if (!current()) return null;
      const { data: { session } } = await supabase.auth.getSession();
      return current() && session?.user.id === purchaseSession.user.id ? session : null;
    };
    // The App Store purchase starts here.
    logMembershipPath('purchase_started', { tier: upgradeTier, source });
    const result = upgradeTier === 'essential'
      ? await purchaseEssential()
      : await purchasePremium();
    const session = await sameSession();
    // A different account (or a screen that has gone) must not be credited
    // with how this purchase ended, so nothing is logged for it.
    if (!session) return;
    logMembershipPath(
      result === 'success' ? 'purchase_succeeded' : result === 'failed' ? 'purchase_failed' : 'purchase_cancelled',
      { tier: upgradeTier, source },
    );
    if (result === 'success') {
      // The store verified it: unlock now, then let the server mirror catch up.
      // A failed refresh must not leave the sheet open inviting a second purchase.
      if (user) recordVerifiedPurchase(user.id, upgradeTier);
      // Eligibility changed with the purchase.
      retryPrices();
      await withTimeoutFallback(
        Promise.resolve(supabase.functions.invoke('sync-iap-entitlements', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })).then(() => undefined),
        10_000,
        undefined,
      );
      if (!current()) return;
      await refreshAccount().catch(() => undefined);
      if (!current()) return;
      closeUpgrade();
    } else if (result === 'failed') {
      appAlert(t('upgradeSheet.title'), t('upgradeSheet.iapError'));
    }
  }

  function openUpgrade(tier: SubscriptionTier) {
    setReviewPromptPaywallVisible(true);
    setUpgradeTier(tier);
    setUpgradeOpen(true);
    logMembershipPath('plan_sheet_opened', { tier, source });
  }

  function closeUpgrade() {
    setReviewPromptPaywallVisible(false);
    setUpgradeOpen(false);
  }

  return {
    subscriptionPrices,
    trialLabel,
    purchasing,
    retryPrices,
    upgradeOpen,
    upgradeTier,
    openUpgrade,
    closeUpgrade,
    handlePurchase,
  };
}

export type PlanPurchase = ReturnType<typeof usePlanPurchase>;
