import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
  const sheetOpened = useRef(false);
  const { openUpgrade } = plan;
  useEffect(() => {
    if (sheetOpened.current || !requestedTier || !user || isLoading) return;
    sheetOpened.current = true;
    if (purchasableTiers(accountState).includes(requestedTier)) openUpgrade(requestedTier);
  }, [requestedTier, user, isLoading, accountState, openUpgrade]);

  return (
    <ScreenContainer backgroundColor={colors.cream}>
      <UpgradeSheet
        visible={plan.upgradeOpen}
        tier={plan.upgradeTier}
        price={plan.subscriptionPrices[plan.upgradeTier]}
        trial={plan.trialLabel(plan.upgradeTier)}
        onClose={plan.closeUpgrade}
        onPurchase={() => void plan.handlePurchase()}
        purchasing={plan.purchasing}
      />
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.backBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('common:a11y.back')}
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
