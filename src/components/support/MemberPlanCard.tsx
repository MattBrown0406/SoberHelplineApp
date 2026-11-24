import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { useLanguage } from '../../hooks/useLanguage';
import { buttonShape } from '../ui/Button';
import { benefitSummary } from '../../lib/membershipBenefits';
import { plansHref } from '../../lib/membershipPath';
import type { AccountState } from '../../api/types';
import { supportCard, supportEyebrow } from './cardStyle';

/**
 * A member's plan (Essential or Premier), shown once and unambiguously, with
 * the crisis guide & plan review. Upgrading is an explicit button.
 */
export function MemberPlanCard({
  accountState,
}: {
  accountState: AccountState;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('support');
  const { t: tPlans } = useTranslation('plans');
  const { current } = useLanguage();
  const router = useRouter();
  return (
    <View style={[styles.card, { borderColor: colors.line }]}>
      <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
        {t('tier.eyebrow')}
      </Text>
      <Text style={[styles.body, { color: colors.inkSoft, marginBottom: 12 }]}>
        {t('tier.reviewIntro')}
      </Text>

      <View style={[styles.tierRow, { borderColor: colors.primary, backgroundColor: colors.primaryLight }]}>
        <View style={styles.tierInfo}>
          <Text style={[styles.tierName, { color: colors.primary }]}>
            {t(accountState === 'direct-premium' ? 'tier.premiumName' : 'tier.essentialName')}
          </Text>
          <Text style={[styles.tierFeatures, { color: colors.inkSoft }]}>
            {benefitSummary(accountState === 'direct-premium' ? 'premier' : 'essential', tPlans as never, current)}
          </Text>
        </View>
        <View style={styles.tierRight}>
          <Text style={[styles.tierCurrent, { color: colors.primary }]}>
            {t('tier.current')}
          </Text>
        </View>
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        style={[styles.solidBtn, { backgroundColor: colors.primary }]}
        activeOpacity={0.85}
        onPress={() => router.push('/crisis-mode')}
      >
        <Text style={styles.solidBtnText}>{t('tier.openPlanReview')}</Text>
      </TouchableOpacity>

      {accountState === 'direct-essential' && (
        <TouchableOpacity
          style={[styles.outlineBtn, { borderColor: colors.primary }]}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={tPlans('support.upgradeLabel')}
          onPress={() => router.push(plansHref('support_upgrade', 'premium'))}
        >
          <Text style={[styles.outlineBtnText, { color: colors.primary }]}>
            {t('tier.upgradeButton')}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: supportCard,
  eyebrow: supportEyebrow,
  body: { fontSize: 13, lineHeight: 19 },
  tierRow: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
    alignItems: 'center',
  },
  tierInfo: { flex: 1 },
  tierName: { fontSize: 14, fontWeight: '700' },
  tierFeatures: { fontSize: 12, marginTop: 2 },
  tierRight: { alignItems: 'flex-end' },
  tierCurrent: { fontSize: 11, marginTop: 2 },
  solidBtn: {
    ...buttonShape,
    paddingVertical: 12,
    marginTop: 4,
  },
  solidBtnText: { color: '#fff', fontWeight: '700', fontSize: 14, lineHeight: 20, textAlign: 'center', flexShrink: 1 },
  outlineBtn: {
    ...buttonShape,
    borderWidth: 1.5,
    paddingVertical: 10,
    marginTop: 8,
  },
  outlineBtnText: { fontWeight: '700', fontSize: 14, lineHeight: 20, textAlign: 'center', flexShrink: 1 },
});
