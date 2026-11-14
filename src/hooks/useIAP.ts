import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAccount } from '../contexts/AccountContext';
import Purchases, { type PurchasesOfferings, type PurchasesPackage } from 'react-native-purchases';
import { PURCHASE_NOT_STARTED, purchaseRevenueCatPackage } from '../lib/revenueCat';
import { PRE_STORE_STEP_MS, beforeStoreStep, type PurchaseControl } from '../lib/purchaseSteps';
import { setReviewPromptPurchaseFlow } from '../lib/reviewPrompt';
import { freeTrialOffer, type TrialOffer } from '../lib/subscriptionTrial';

export type SubscriptionTier = 'essential' | 'premium';
export type PurchaseResult = 'success' | 'cancelled' | 'failed';

let activePurchaseFlows = 0;
const PRICE_RETRY_DELAYS_MS = [5_000, 15_000, 45_000];

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
  const { user } = useAccount();
  const owner = user?.id;
  const lifetimeRef = useRef({ owner, active: true, purchasing: false, generation: 0 });
  if (lifetimeRef.current.owner !== owner) {
    lifetimeRef.current.active = false;
    lifetimeRef.current = { owner, active: true, purchasing: false, generation: 0 };
  }
  const lifetime = lifetimeRef.current;
  const isActive = () => lifetime.active && lifetimeRef.current === lifetime;
  useEffect(() => {
    lifetime.active = true;
    lifetime.generation += 1;
    return () => { lifetime.active = false; lifetime.generation += 1; };
  }, [lifetime]);
  const [purchasing, setPurchasing] = useState(false);
  const [iapError, setIapError] = useState<string | null>(null);
  const [prices, setPrices] = useState<Partial<Record<SubscriptionTier, string>>>({});
  // A free trial the store will give her (eligibility checked), per tier.
  const [trials, setTrials] = useState<Partial<Record<SubscriptionTier, TrialOffer>>>({});

  const [priceAttempt, setPriceAttempt] = useState(0);
  const retryPrices = () => setPriceAttempt((value) => value + 1);
  const pricesLoaded = !!prices.essential && !!prices.premium;
  const autoRetries = useRef(0);

  useEffect(() => {
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    Purchases.getOfferings()
      .then((offerings) => {
        if (!active) return;
        const essential = findPackage(offerings, 'essential');
        const premium = findPackage(offerings, 'premium');
        setPrices({
          ...(essential ? { essential: essential.product.priceString } : {}),
          ...(premium ? { premium: premium.product.priceString } : {}),
        });
        if (essential && premium) autoRetries.current = 0;
        const packages = { essential, premium };
        const ids = [essential, premium].flatMap((pkg) => (pkg?.product.introPrice ? [pkg.product.identifier] : []));
        if (!ids.length) {
          setTrials({});
          return;
        }
        // No answer means no trial shown: the purchase sheet still states the terms.
        Purchases.checkTrialOrIntroductoryPriceEligibility(ids)
          .then((eligibility) => {
            if (!active) return;
            const next: Partial<Record<SubscriptionTier, TrialOffer>> = {};
            for (const tier of ['essential', 'premium'] as const) {
              const pkg = packages[tier];
              const offer = pkg ? freeTrialOffer(pkg.product.introPrice, eligibility[pkg.product.identifier]?.status) : null;
              if (offer) next[tier] = offer;
            }
            setTrials(next);
          })
          .catch(() => { if (active) setTrials({}); });
      })
      .catch(() => {
        // Do not invent a price. The buy buttons stay disabled until a load
        // succeeds, so retry a few times on our own (a cold start on a bad
        // connection) instead of relying on the Retry control alone.
        if (!active || autoRetries.current >= PRICE_RETRY_DELAYS_MS.length) return;
        retryTimer = setTimeout(retryPrices, PRICE_RETRY_DELAYS_MS[autoRetries.current]);
        autoRetries.current += 1;
      });
    return () => { active = false; if (retryTimer) clearTimeout(retryTimer); };
  }, [priceAttempt, owner]);

  // Coming back to the app with prices still missing: try again.
  useEffect(() => {
    if (pricesLoaded) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      autoRetries.current = 0;
      retryPrices();
    });
    return () => sub.remove();
  }, [pricesLoaded]);

  async function purchaseTier(tier: SubscriptionTier, control: PurchaseControl = {}): Promise<PurchaseResult> {
    const generation = lifetime.generation;
    // "On screen": this screen is still mounted for the account that tapped.
    // It decides whether a purchase may START and whether this hook's own
    // state is updated. It never decides how a purchase the store has already
    // answered is reported: she may have been charged, and the caller
    // (usePlanPurchase) must hear about it even after the screen has gone.
    const current = () => isActive() && generation === lifetime.generation;
    if (!owner || !current() || lifetime.purchasing) return 'cancelled';
    lifetime.purchasing = true;
    activePurchaseFlows += 1;
    setReviewPromptPurchaseFlow(true);
    setPurchasing(true);
    setIapError(null);
    // Set the moment a wait before the store is given up (too slow, or she
    // left): whatever was still on its way must start nothing afterwards.
    let abandoned = false;
    const mayStart = () => !abandoned && current() && (control.mayStart?.() ?? true);
    const giveUp = () => { abandoned = true; };
    try {
      // Before the store is asked, every step has a time limit and she may
      // leave (purchaseSteps). Nothing has been bought yet.
      const loaded = await beforeStoreStep(Purchases.getOfferings(), { limitMs: PRE_STORE_STEP_MS, left: control.left, onStop: giveUp });
      if (loaded.outcome === 'left') return 'cancelled';
      if (loaded.outcome === 'timeout') {
        if (current()) setIapError('store_timeout');
        return 'failed';
      }
      // A screen that has gone, or a sheet she closed, starts nothing.
      if (!mayStart()) return 'cancelled';
      const pkg = findPackage(loaded.value, tier);
      if (!pkg) {
        setIapError('tier_not_configured');
        return 'failed';
      }

      // Bought as `owner` (checked inside the identity queue, which also holds
      // every sign-in and sign-out until the store has answered). The time
      // limit covers only the wait UNTIL the store's purchase call is made;
      // from that call on, its answer is always waited for.
      let storeAsked: () => void = () => undefined;
      const untilStore = new Promise<void>((resolve) => { storeAsked = resolve; });
      const purchase = purchaseRevenueCatPackage(pkg, owner, mayStart, {
        confirmOwner: control.confirmOwner,
        onStoreCall: () => {
          storeAsked();
          control.onStoreCall?.();
        },
      });
      // (Ended before the store was asked: the wait is over too.)
      purchase.then(storeAsked, storeAsked);
      const reached = await beforeStoreStep(untilStore, { limitMs: PRE_STORE_STEP_MS, left: control.left, onStop: giveUp });
      if (reached.outcome !== 'done') {
        // Still queued behind a login that has stalled: it starts nothing now.
        purchase.catch(() => undefined);
        if (reached.outcome === 'left') return 'cancelled';
        if (current()) setIapError('store_timeout');
        return 'failed';
      }
      const result = await purchase;
      if (!result.customerInfo.entitlements.active[tier]) {
        if (current()) setIapError('entitlement_not_granted');
        return 'failed';
      }
      return 'success';
    } catch (err: unknown) {
      const rcErr = err as { userCancelled?: boolean; message?: string };
      if (rcErr.userCancelled) return 'cancelled';
      // She left, or the screen or the account changed, before the store was
      // asked: not a failure. (RevenueCat not being on this account IS one:
      // PURCHASE_NOT_IDENTIFIED falls through to 'failed', so she is told.)
      if (rcErr.message === PURCHASE_NOT_STARTED) return 'cancelled';
      console.error(`[useIAP] ${tier} purchase failed:`, err);
      if (current()) setIapError(rcErr.message ?? 'purchase_failed');
      return 'failed';
    } finally {
      lifetime.purchasing = false;
      if (current()) setPurchasing(false);
      activePurchaseFlows -= 1;
      if (activePurchaseFlows === 0) setReviewPromptPurchaseFlow(false);
    }
  }

  return {
    purchasePremium: (control?: PurchaseControl) => purchaseTier('premium', control),
    purchaseEssential: (control?: PurchaseControl) => purchaseTier('essential', control),
    purchasing: purchasing && lifetime.purchasing,
    iapError,
    prices,
    trials,
    retryPrices,
  };
}
