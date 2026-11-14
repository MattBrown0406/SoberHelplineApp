import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import type { PlanOffers } from '../../hooks/usePlanPurchase';
import { plansHref, type PlanSource } from '../../lib/membershipPath';
import { BenefitList } from './BenefitList';

/**
 * The compact plans card (Support tab, free members): Essential's store
 * price, its first few benefits from the one list, and a button that opens
 * the plans screen. Nothing is bought from here.
 */
export function PlansTeaserCard({
  offers,
  source,
}: {
  offers: Pick<PlanOffers, 'subscriptionPrices' | 'trialLabel'>;
  source: PlanSource;
}) {
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation('support');
  const { t: tPlans } = useTranslation('plans');
  const price = offers.subscriptionPrices.essential;
  const trial = offers.trialLabel('essential');
  return (
    <View style={[styles.card, { borderColor: colors.line, backgroundColor: colors.white }]}>
      <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>{tPlans('support.eyebrow')}</Text>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{tPlans('support.title')}</Text>
      <View style={styles.planHead}>
        <Text style={[styles.planName, { color: colors.primary }]}>{t('tier.essentialName')}</Text>
        <Text style={[styles.planPrice, { color: colors.primary }]}>
          {price ? tPlans('perMonth', { price }) : tPlans('priceUnavailable')}
        </Text>
      </View>
      {trial && price ? (
        <Text style={[styles.trial, { color: colors.primary }]}>{t('paywall.trialThen', { trial, price })}</Text>
      ) : null}
      <BenefitList plan="essential" limit={3} />
      <Text style={[styles.more, { color: colors.inkSoft }]}>{tPlans('support.more')}</Text>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary }]}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={tPlans('seePlansLabel')}
        onPress={() => router.push(plansHref(source))}
      >
        <Text style={styles.buttonText}>{tPlans('seePlans')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 6 },
  title: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  planHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  planName: { fontSize: 14, fontWeight: '700' },
  planPrice: { fontSize: 14, fontWeight: '700' },
  trial: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  more: { fontSize: 13, lineHeight: 19, marginTop: 10 },
  button: {
    minHeight: 44,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
