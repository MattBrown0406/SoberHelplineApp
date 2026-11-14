import React, { useEffect, useRef } from 'react';
import { BackHandler, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { PlansCard } from '../src/components/plans/PlansCard';
import { UpgradeSheet } from '../src/components/plans/UpgradeSheet';
import { useAccount } from '../src/contexts/AccountContext';
import { useTheme } from '../src/contexts/ThemeContext';
import { usePlanPurchase } from '../src/hooks/usePlanPurchase';
import { useRestorePurchases } from '../src/hooks/useRestorePurchases';
import { logMembershipPath } from '../src/lib/funnel';
import { planSource, planTier, purchasableTiers } from '../src/lib/membershipPath';

/**
 * How long after the screen is ready a named plan's sheet is presented: longer
 * than the push animation and an alert closing, short enough to feel direct.
 */
const SHEET_SETTLE_MS = 450;

/**
 * The plans screen: the one place plans are shown in full and bought.
 *
 * Every "See plans" or "Upgrade" button in the app opens it (plansHref) with
 * `source`, a short label for where she came from, and sometimes `tier`,
 * which opens that plan's purchase sheet straight away.
 */
export default function PlansScreen() {
  const params = useLocalSearchParams<{ source?: string; tier?: string }>();
  const source = planSource(params.source);
  const requestedTier = planTier(params.tier);
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation('plans');
  const { user, accountState, isLoading } = useAccount();
  const plan = usePlanPurchase(source);
  const { restoring, handleRestore } = useRestorePurchases();

  // Seen: once per visit to this screen, however often it re-renders.
  const viewLogged = useRef(false);
  useEffect(() => {
    if (viewLogged.current || !user) return;
    viewLogged.current = true;
    logMembershipPath('plans_viewed', { source });
  }, [user, source]);

  // A button that named a plan opens its sheet once, and only for a plan she
  // can actually buy (an Essential member is never offered Essential again).
  // It opens a beat after this screen has arrived, not on mount: a sheet
  // presented during the push (or while the alert that led here is still
  // closing) can be dropped by iOS, leaving the app believing a sheet is open
  // that is not. (And a plan button always re-presents it: usePlanPurchase.)
  const sheetOpened = useRef(false);
  const openUpgradeRef = useRef(plan.openUpgrade);
  openUpgradeRef.current = plan.openUpgrade;
  const sheetShowing = useRef(plan.upgradeOpen);
  sheetShowing.current = plan.upgradeOpen;
  const sheetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (sheetOpened.current || !requestedTier || !user || isLoading) return;
    sheetOpened.current = true;
    if (!purchasableTiers(accountState).includes(requestedTier)) return;
    sheetTimer.current = setTimeout(() => {
      sheetTimer.current = null;
      // She may have tapped a plan herself in the meantime: that sheet stays.
      if (!sheetShowing.current) openUpgradeRef.current(requestedTier);
    }, SHEET_SETTLE_MS);
  }, [requestedTier, user, isLoading, accountState]);
  // Cleared only when the screen goes: a re-render must not cancel the opening.
  useEffect(() => () => { if (sheetTimer.current) clearTimeout(sheetTimer.current); }, []);

  // While the App Store has not answered, she stays here: leaving used to
  // drop the result of a purchase she was charged for. Android's back button
  // is swallowed, the swipe-back is off, and the back arrow is disabled.
  const { purchaseInFlight } = plan;
  useEffect(() => {
    if (!purchaseInFlight) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [purchaseInFlight]);

  return (
    <ScreenContainer backgroundColor={colors.cream}>
      <Stack.Screen options={{ gestureEnabled: !purchaseInFlight }} />
      <UpgradeSheet
        key={plan.sheetAttempt}
        visible={plan.upgradeOpen}
        tier={plan.upgradeTier}
        price={plan.subscriptionPrices[plan.upgradeTier]}
        trial={plan.trialLabel(plan.upgradeTier)}
        onClose={plan.closeUpgrade}
        onPurchase={() => void plan.handlePurchase()}
        purchasing={plan.purchasing}
        closeDisabled={purchaseInFlight}
      />
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.backBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('common:a11y.back')}
          accessibilityState={{ disabled: purchaseInFlight }}
          disabled={purchaseInFlight}
          onPress={() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)/support'); }}
        >
          <Text style={[styles.back, { color: colors.primary }]}>‹</Text>
        </TouchableOpacity>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('title')}</Text>
      </View>
      <Text style={[styles.intro, { color: colors.inkSoft }]}>{t('intro')}</Text>
      <Text style={[styles.intro, { color: colors.inkSoft }]}>{t('monthly')}</Text>
      <PlansCard
        accountState={accountState}
        offers={plan}
        onChoose={plan.openUpgrade}
        onRestore={() => void handleRestore()}
        restoring={restoring}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 8 },
  backBtn: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  back: { fontSize: 30, lineHeight: 34 },
  title: { flex: 1, fontSize: 24, fontWeight: '700', letterSpacing: -0.4 },
  intro: { fontSize: 14, lineHeight: 21, marginBottom: 10 },
});
