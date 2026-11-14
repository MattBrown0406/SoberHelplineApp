import React from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '../../config';
import type { SubscriptionTier } from '../../hooks/useIAP';
import type { PlanOffers } from '../../hooks/usePlanPurchase';
import { planForAccountState } from '../../lib/membershipBenefits';
import { purchasableTiers } from '../../lib/membershipPath';
import { BenefitList } from './BenefitList';

/**
 * The plans, in full: what stays free, what Essential includes and what
 * Premier adds (one list, plans.json), each plan's store price and trial,
 * the auto-renew disclosure, Terms and Privacy, and Restore Purchases.
 *
 * Choosing a plan opens its purchase sheet through `onChoose`; this card
 * never starts a purchase itself. A plan she already has is marked and has
 * no button; a provider-covered member sees no buttons at all.
 */
export function PlansCard({
  accountState,
  offers,
  onChoose,
  onRestore,
  restoring,
}: {
  accountState: string | null | undefined;
  offers: Pick<PlanOffers, 'subscriptionPrices' | 'trialLabel' | 'purchasing' | 'retryPrices'>;
  onChoose: (tier: SubscriptionTier) => void;
  onRestore: () => void;
  restoring: boolean;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('support');
  const { t: tPlans } = useTranslation('plans');
  const { subscriptionPrices, trialLabel, purchasing, retryPrices } = offers;
  const current = planForAccountState(accountState);
  const canBuy = purchasableTiers(accountState);
  const priceLine = (tier: SubscriptionTier) => (subscriptionPrices[tier]
    ? tPlans('perMonth', { price: subscriptionPrices[tier] })
    : tPlans('priceUnavailable'));
  const buyLabel = (tier: SubscriptionTier) => {
    const price = subscriptionPrices[tier];
    if (!price) return tPlans('priceUnavailable');
    const trial = trialLabel(tier);
    if (trial) return t('paywall.startTrial', { trial, price });
    return t(tier === 'essential' ? 'paywall.subscribeEssential' : 'paywall.subscribePremium', { price });
  };
  const pricesMissing = !subscriptionPrices.essential || !subscriptionPrices.premium;

  const paidPlan = (tier: SubscriptionTier) => {
    const plan = tier === 'premium' ? 'premier' : 'essential';
    const isCurrent = current === plan;
    const lead = tier === 'essential';
    const trial = trialLabel(tier);
    return (
      <View
        style={[
          styles.plan,
          { borderColor: lead ? colors.primary : colors.line, backgroundColor: lead ? colors.primaryLight : colors.white },
        ]}
      >
        <View style={styles.planHead}>
          <Text accessibilityRole="header" style={[styles.planName, { color: lead ? colors.primary : colors.ink }]}>
            {t(`tier.${tier}Name`)}
          </Text>
          <Text style={[styles.planPrice, { color: lead ? colors.primary : colors.ink }]}>
            {/* A price only where there is something to buy. */}
            {isCurrent ? tPlans('currentPlan') : canBuy.includes(tier) ? priceLine(tier) : ''}
          </Text>
        </View>
        {trial && canBuy.includes(tier) ? (
          <Text style={[styles.trial, { color: colors.primary }]}>
            {t('paywall.trialThen', { trial, price: subscriptionPrices[tier] })}
          </Text>
        ) : null}
        <Text style={[styles.planHeading, { color: colors.inkSoft }]}>{tPlans(`headings.${plan}`)}</Text>
        <BenefitList plan={plan} />
        {canBuy.includes(tier) ? (
          <TouchableOpacity
            style={[
              lead ? styles.solidBtn : styles.outlineBtn,
              lead ? { backgroundColor: colors.primary } : { borderColor: colors.primary },
            ]}
            activeOpacity={0.85}
            // No store price yet: nothing to agree to. "Retry prices" is below.
            disabled={purchasing || !subscriptionPrices[tier]}
            accessibilityRole="button"
            accessibilityLabel={buyLabel(tier)}
            accessibilityState={{ disabled: purchasing || !subscriptionPrices[tier], busy: purchasing }}
            onPress={() => onChoose(tier)}
          >
            <Text style={lead ? styles.solidBtnText : [styles.outlineBtnText, { color: colors.primary }]}>
              {purchasing ? '...' : buyLabel(tier)}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  return (
    <View>
      {current === 'covered' ? (
        <Text style={[styles.note, { color: colors.ink, marginBottom: 12 }]}>{tPlans('covered')}</Text>
      ) : null}

      {/* Free: what never needs a plan. */}
      <View style={[styles.plan, { borderColor: colors.line, backgroundColor: colors.cream }]}>
        <View style={styles.planHead}>
          <Text accessibilityRole="header" style={[styles.planName, { color: colors.ink }]}>{t('tier.freeName')}</Text>
          {current === 'free' ? (
            <Text style={[styles.planPrice, { color: colors.inkSoft }]}>{tPlans('yourPlan')}</Text>
          ) : null}
        </View>
        <Text style={[styles.planHeading, { color: colors.inkSoft }]}>{tPlans('headings.free')}</Text>
        <BenefitList plan="free" color={colors.inkSoft} />
      </View>

      {paidPlan('essential')}
      {paidPlan('premium')}

      <Text style={[styles.note, { color: colors.inkSoft }]}>{tPlans('notEmergency')}</Text>

      {canBuy.length > 0 ? (
        <>
          {/* Auto-renewable subscription disclosure + legal links (App Store 3.1.2c) */}
          <Text style={[styles.disclosure, { color: colors.inkSoft }]}>
            {t('paywall.autoRenewDisclosure', {
              essentialPrice: subscriptionPrices.essential ?? tPlans('priceUnavailable'),
              premiumPrice: subscriptionPrices.premium ?? tPlans('priceUnavailable'),
            })}
            {canBuy.some((tier) => trialLabel(tier)) ? ` ${t('paywall.trialDisclosure')}` : ''}
          </Text>
          {pricesMissing ? (
            <TouchableOpacity
              style={[styles.outlineBtn, { borderColor: colors.line }]}
              accessibilityRole="button"
              accessibilityLabel={tPlans('retryPricesLabel')}
              onPress={retryPrices}
            >
              <Text style={[styles.outlineBtnText, { color: colors.primary }]}>{tPlans('retryPrices')}</Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}

      <View style={styles.legalRow}>
        <TouchableOpacity
          style={styles.legalBtn}
          accessibilityRole="link"
          accessibilityLabel={tPlans('choose.termsLabel')}
          onPress={() => void Linking.openURL(TERMS_OF_USE_URL)}
        >
          <Text style={[styles.legalLink, { color: colors.primary }]}>{t('upgradeSheet.termsOfUse')}</Text>
        </TouchableOpacity>
        <Text style={[styles.legalSep, { color: colors.inkSoft }]}> · </Text>
        <TouchableOpacity
          style={styles.legalBtn}
          accessibilityRole="link"
          accessibilityLabel={tPlans('choose.privacyLabel')}
          onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
        >
          <Text style={[styles.legalLink, { color: colors.primary }]}>{t('upgradeSheet.privacyPolicy')}</Text>
        </TouchableOpacity>
      </View>

      {/* Restore Purchases must stay reachable wherever plans are sold. A
          provider-covered member manages any store subscription in Settings. */}
      {current !== 'covered' ? (
        <TouchableOpacity
          style={[styles.outlineBtn, { borderColor: colors.line }]}
          activeOpacity={0.8}
          disabled={restoring}
          accessibilityRole="button"
          accessibilityLabel={tPlans('restore.label')}
          accessibilityState={{ disabled: restoring, busy: restoring }}
          onPress={onRestore}
        >
          {restoring ? (
            <ActivityIndicator color={colors.primary} accessibilityLabel={tPlans('restore.busy')} />
          ) : (
            <Text style={[styles.outlineBtnText, { color: colors.primary }]}>{tPlans('restore.button')}</Text>
          )}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  plan: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  planHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  planName: { fontSize: 17, fontWeight: '700' },
  planPrice: { fontSize: 14, fontWeight: '700' },
  planHeading: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4, marginTop: 10 },
  trial: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  note: { fontSize: 13, lineHeight: 19 },
  disclosure: { fontSize: 11.5, lineHeight: 16, textAlign: 'center', marginTop: 14 },
  solidBtn: {
    minHeight: 44,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  solidBtnText: { color: '#fff', fontWeight: '700', fontSize: 14, lineHeight: 20, textAlign: 'center', flexShrink: 1 },
  outlineBtn: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginTop: 14,
  },
  outlineBtnText: { fontWeight: '700', fontSize: 14, lineHeight: 20, textAlign: 'center', flexShrink: 1 },
  legalRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  legalBtn: { minHeight: 44, justifyContent: 'center' },
  legalLink: { fontSize: 12, fontWeight: '500', textDecorationLine: 'underline' },
  legalSep: { fontSize: 12 },
});
