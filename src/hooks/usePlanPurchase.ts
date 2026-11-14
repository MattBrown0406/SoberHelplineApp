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
  // Bumped when a plan button is tapped while the sheet already counts as
  // open: the screen keys the sheet on it, so it is presented afresh.
  const [sheetAttempt, setSheetAttempt] = useState(0);
  const upgradeOpenRef = useRef(false);

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

  // One purchase at a time, from the tap until everything after it is done.
  // 'store' = the App Store has not answered yet (she must not leave);
  // 'finishing' = it said yes and the membership is being switched on.
  const purchaseFlow = useRef<{ phase: 'idle' | 'store' | 'finishing' }>({ phase: 'idle' });
  const [flowPhase, setFlowPhase] = useState<'idle' | 'store' | 'finishing'>('idle');

  async function handlePurchase() {
    const generation = purchaseOwner.generation;
    // "On screen": this screen is still open for the account that tapped. Only
    // what she SEES depends on it (closing the sheet, the failure message).
    const onScreen = () => purchaseOwner.active && purchaseOwnerRef.current === purchaseOwner && generation === purchaseOwner.generation;
    if (!onScreen() || !purchaseOwner.owner) return;
    if (!subscriptionPrices[upgradeTier]) return;
    // A fast second tap must not log a second start, nor a "cancelled" for a
    // purchase that is still going.
    if (purchaseFlow.current.phase !== 'idle') return;
    const setPhase = (phase: 'idle' | 'store' | 'finishing') => {
      purchaseFlow.current.phase = phase;
      setFlowPhase(phase);
    };
    setPhase('store');
    try {
      const { data: { session: purchaseSession } } = await supabase.auth.getSession();
      if (!onScreen() || !purchaseSession) return;
      // The same person is still signed in. Deliberately NOT tied to this
      // screen: a purchase the store finished after the screen closed is still
      // hers, and must be recorded or she is charged but stays "free".
      const sameSession = async () => {
        if (purchaseOwnerRef.current !== purchaseOwner) return null;
        const { data: { session } } = await supabase.auth.getSession();
        return purchaseOwnerRef.current === purchaseOwner && session?.user.id === purchaseSession.user.id ? session : null;
      };
      // The App Store purchase starts here.
      logMembershipPath('purchase_started', { tier: upgradeTier, source });
      const result = upgradeTier === 'essential'
        ? await purchaseEssential()
        : await purchasePremium();
      const session = await sameSession();
      // A different account must not be credited with how this purchase
      // ended, so nothing is logged or recorded for it.
      if (!session) return;
      logMembershipPath(
        result === 'success' ? 'purchase_succeeded' : result === 'failed' ? 'purchase_failed' : 'purchase_cancelled',
        { tier: upgradeTier, source },
      );
      if (result === 'success') {
        // She may leave from here on: the rest finishes without this screen.
        setPhase('finishing');
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
        // Signed out or switched while the server caught up: not hers to refresh.
        if (!(await sameSession())) return;
        await refreshAccount().catch(() => undefined);
        if (!onScreen()) return;
        closeUpgrade();
      } else if (result === 'failed') {
        if (onScreen()) appAlert(t('upgradeSheet.title'), t('upgradeSheet.iapError'));
      }
    } finally {
      setPhase('idle');
    }
  }

  function openUpgrade(tier: SubscriptionTier) {
    if (purchaseFlow.current.phase !== 'idle') return;
    setReviewPromptPaywallVisible(true);
    setUpgradeTier(tier);
    // A tap on a plan button means the sheet is NOT in front of her, whatever
    // the state says (iOS can drop a sheet presented during another
    // transition): present it again rather than doing nothing.
    if (upgradeOpenRef.current) setSheetAttempt((value) => value + 1);
    upgradeOpenRef.current = true;
    setUpgradeOpen(true);
    logMembershipPath('plan_sheet_opened', { tier, source });
  }

  function closeUpgrade() {
    // The App Store has not answered yet: the sheet stays until it does.
    if (purchaseFlow.current.phase === 'store') return;
    setReviewPromptPaywallVisible(false);
    upgradeOpenRef.current = false;
    setUpgradeOpen(false);
  }

  return {
    subscriptionPrices,
    trialLabel,
    // The buy buttons stay off until the whole flow is done.
    purchasing: purchasing || flowPhase !== 'idle',
    // True only while the App Store has not answered: no leaving, no closing.
    purchaseInFlight: purchasing || flowPhase === 'store',
    retryPrices,
    upgradeOpen,
    upgradeTier,
    sheetAttempt,
    openUpgrade,
    closeUpgrade,
    handlePurchase,
  };
}

export type PlanPurchase = ReturnType<typeof usePlanPurchase>;
