import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAccount } from '../contexts/AccountContext';
import { supabase } from '../lib/supabase';
import { recordVerifiedPurchase, withTimeoutFallback } from '../lib/authBootstrap';
import { appAlert } from '../lib/appAlert';
import { logMembershipPath } from '../lib/funnel';
import type { PlanSource } from '../lib/membershipPath';
import {
  PRE_STORE_STEP_MS,
  STORE_ANSWER_WAIT_MS,
  beforeStoreStep,
  newPurchaseAttempt,
  purchaseAccountNow,
  purchaseExitsLocked,
  type PurchaseAttempt,
  type PurchaseControl,
} from '../lib/purchaseSteps';
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

type FlowPhase = 'idle' | 'preparing' | 'store' | 'finishing';

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
  // 'preparing' = she tapped, but the App Store has not been asked yet: nothing
  //               is bought, so she may still close the sheet or go back, and
  //               that ends the attempt;
  // 'store'     = the App Store's purchase call is in flight (she must not leave,
  //               unless it has said nothing for two minutes: `storeSlow`);
  // 'finishing' = it said yes and the membership is being switched on.
  const purchaseFlow = useRef<{ phase: FlowPhase; attempt: PurchaseAttempt | null; storeSlow?: boolean }>({ phase: 'idle', attempt: null });
  const [flowPhase, setFlowPhase] = useState<FlowPhase>('idle');
  // The store was asked and has not answered for two minutes: she is no
  // longer held on this screen (purchaseSteps.STORE_ANSWER_WAIT_MS). The
  // purchase itself is still waited for and recorded when the answer comes.
  const [storeSlow, setStoreSlow] = useState(false);
  const storeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Starts the two-minute wait when the store is asked; ends it on any other step. */
  function watchStore(asked: boolean) {
    if (storeTimer.current) clearTimeout(storeTimer.current);
    storeTimer.current = null;
    purchaseFlow.current.storeSlow = false;
    setStoreSlow(false);
    if (!asked) return;
    storeTimer.current = setTimeout(() => {
      storeTimer.current = null;
      if (purchaseFlow.current.phase !== 'store') return;
      purchaseFlow.current.storeSlow = true;
      setStoreSlow(true);
    }, STORE_ANSWER_WAIT_MS);
  }
  useEffect(() => () => { if (storeTimer.current) clearTimeout(storeTimer.current); }, []);
  // Leaving the screen before the store was asked ends the attempt as well.
  useEffect(() => () => {
    if (purchaseFlow.current.phase === 'preparing') purchaseFlow.current.attempt?.leave();
  }, []);

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
    const attempt = newPurchaseAttempt();
    purchaseFlow.current.attempt = attempt;
    // Only the attempt that owns the flow moves it: one she has left (the flow
    // is already free again, perhaps for a newer tap) changes nothing.
    const setPhase = (phase: FlowPhase) => {
      if (purchaseFlow.current.attempt !== attempt) return;
      purchaseFlow.current.phase = phase;
      if (phase === 'idle') purchaseFlow.current.attempt = null;
      setFlowPhase(phase);
      watchStore(phase === 'store');
    };
    setPhase('preparing');
    try {
      // Every step before the store is asked has a time limit, and stops at
      // once if she leaves (purchaseSteps): a stalled connection must never
      // hold her on this screen with no payment sheet in sight.
      // (A read that fails outright is the same to her as one that is too slow.)
      const sessionStep = await beforeStoreStep(supabase.auth.getSession(), { limitMs: PRE_STORE_STEP_MS, left: attempt.whenLeft }).catch(() => null);
      if (sessionStep?.outcome === 'left' || !onScreen()) return;
      const purchaseSession = sessionStep?.outcome === 'done' ? sessionStep.value.data.session : null;
      if (!purchaseSession) {
        // Too slow, failed, or nobody is signed in: nothing was bought, and
        // she is told so. A tap on Subscribe never just does nothing.
        appAlert(t('upgradeSheet.iapErrorTitle'), t('upgradeSheet.iapError'));
        return;
      }
      // The same person is still signed in. Deliberately NOT tied to this
      // screen: a purchase the store finished after the screen closed is still
      // hers, and must be recorded or she is charged but stays "free".
      const sameSession = async () => {
        if (purchaseOwnerRef.current !== purchaseOwner) return null;
        const { data: { session } } = await supabase.auth.getSession();
        return purchaseOwnerRef.current === purchaseOwner && session?.user.id === purchaseSession.user.id ? session : null;
      };
      // Who is signed in once the store has said yes. Never fails: a session
      // that cannot be read just now is 'unknown', which is not "someone
      // else" (purchaseAccountNow). Her purchase is dropped only for 'different'.
      const afterPurchase = async () => {
        let sessionNow: typeof purchaseSession | null = null;
        try {
          sessionNow = (await supabase.auth.getSession()).data.session;
        } catch {
          // Unreadable right now.
        }
        const who = purchaseAccountNow({
          buyerAccountId: purchaseOwner.owner ?? '',
          buyerUserId: purchaseSession.user.id,
          accountIdNow: purchaseOwnerRef.current.owner,
          userIdNow: sessionNow?.user.id,
        });
        return { who, session: who === 'same' ? sessionNow : null };
      };
      const control: PurchaseControl = {
        // She closed the sheet or went back: the store is not asked afterwards.
        mayStart: () => !attempt.left,
        left: attempt.whenLeft,
        // The exits lock here, and only here: when the store is really asked.
        onStoreCall: () => setPhase('store'),
        confirmOwner: async () => (await sameSession()) !== null,
      };
      // The purchase starts here; the App Store is asked inside (onStoreCall).
      logMembershipPath('purchase_started', { tier: upgradeTier, source });
      const result = upgradeTier === 'essential'
        ? await purchaseEssential(control)
        : await purchasePremium(control);
      // The store has answered (or was never asked): she may leave again. A
      // purchase that did not go through also frees the buy buttons at once.
      setPhase(result === 'success' ? 'finishing' : 'idle');
      // Whether the same person is still signed in. Only a success waits for
      // this without limit (it must be recorded); the rest is logging.
      let session: Awaited<ReturnType<typeof sameSession>> = null;
      let checked = true;
      // A success only: nobody could be read as signed in, and no other
      // account is. The purchase is hers, and is finished with what was
      // captured before the store was asked.
      let stillHers = false;
      if (result === 'success') {
        const now = await afterPurchase();
        session = now.session;
        stillHers = now.who !== 'different';
      } else {
        // (A read that fails is treated like one that is too slow: not logged,
        // but a failed purchase is still shown.)
        const check = await beforeStoreStep(sameSession(), { limitMs: PRE_STORE_STEP_MS }).catch(() => null);
        checked = check?.outcome === 'done';
        session = check?.outcome === 'done' ? check.value : null;
      }
      // A different account must not be credited with how this purchase
      // ended, so nothing is logged or recorded for it.
      if (checked && !session && !stillHers) return;
      if (session || stillHers) {
        logMembershipPath(
          result === 'success' ? 'purchase_succeeded' : result === 'failed' ? 'purchase_failed' : 'purchase_cancelled',
          { tier: upgradeTier, source },
        );
      }
      if (result === 'success' && stillHers) {
        // The store verified it: unlock now, then let the server mirror catch up.
        // A failed refresh must not leave the sheet open inviting a second purchase.
        // Recorded for the account that tapped Subscribe, captured before the
        // store was asked: an empty session read afterwards must not lose it.
        if (purchaseOwner.owner) recordVerifiedPurchase(purchaseOwner.owner, upgradeTier);
        // Eligibility changed with the purchase.
        retryPrices();
        await withTimeoutFallback(
          Promise.resolve(supabase.functions.invoke('sync-iap-entitlements', {
            headers: { Authorization: `Bearer ${(session ?? purchaseSession).access_token}` },
          })).then(() => undefined),
          10_000,
          undefined,
        );
        // Another account signed in while the server caught up: not hers to refresh.
        if ((await afterPurchase()).who === 'different') return;
        await refreshAccount().catch(() => undefined);
        if (!onScreen()) return;
        closeUpgrade();
      } else if (result === 'failed') {
        // Includes a step that timed out and a purchase that could not start
        // (RevenueCat not on this account). Only her own leaving, or her
        // cancelling in the store's sheet, is silent.
        if (onScreen()) appAlert(t('upgradeSheet.iapErrorTitle'), t('upgradeSheet.iapError'));
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
    const flow = purchaseFlow.current;
    // The App Store has been asked and has not answered yet: the sheet stays
    // until it does, or until it has been silent for two minutes (then she
    // may close it; the answer is still waited for and recorded).
    if (flow.phase === 'store' && !flow.storeSlow) return;
    // Before the store is asked nothing has been bought: closing ends the
    // attempt, quietly, and the buy buttons are free again straight away.
    if (flow.phase === 'preparing') {
      flow.attempt?.leave();
      flow.attempt = null;
      flow.phase = 'idle';
      setFlowPhase('idle');
    }
    setReviewPromptPaywallVisible(false);
    upgradeOpenRef.current = false;
    setUpgradeOpen(false);
  }

  return {
    subscriptionPrices,
    trialLabel,
    // The buy buttons stay off until the whole flow is done.
    purchasing: purchasing || flowPhase !== 'idle',
    // True only while the App Store's own purchase call is in flight: no
    // leaving, no closing. Before that call she can always close or go back,
    // and so she can once the store has been silent for two minutes.
    purchaseInFlight: purchaseExitsLocked(flowPhase, storeSlow),
    // The store has not answered for two minutes: the exits are open again
    // and the screen says the purchase is still being checked.
    stillChecking: flowPhase === 'store' && storeSlow,
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
