import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { useLanguage } from '../../hooks/useLanguage';
import { useCoachingRate } from '../../hooks/useCoachingRate';
import { walletMembershipCopy } from '../../content/walletMembershipCopy';
import { COACHING_MEMBER_PRICE, fillCoachingRates } from '../../lib/coachingPrice';
import type { PlanOffers } from '../../hooks/usePlanPurchase';
import { buttonShape } from '../ui/Button';
import { BenefitList } from '../plans/BenefitList';
import { supportCard } from './cardStyle';

/**
 * "How to use your membership": for someone who has one (the Support tab
 * draws it only then). Closed until she opens it.
 */
export function MembershipGuideCard({
  isAttached,
  offers,
}: {
  isAttached: boolean;
  offers: Pick<PlanOffers, 'subscriptionPrices' | 'retryPrices'>;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('support');
  const { t: tPlans } = useTranslation('plans');
  const router = useRouter();
  const { current } = useLanguage();
  const copy = walletMembershipCopy(current);
  const coachingRate = useCoachingRate();
  const { subscriptionPrices, retryPrices } = offers;
  const [membershipExpanded, setMembershipExpanded] = useState(false);
  return (
    <View style={[styles.card, { borderColor: colors.line, backgroundColor: colors.white }]}>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: membershipExpanded }} aria-expanded={membershipExpanded} onPress={() => setMembershipExpanded((value) => !value)} style={styles.membershipDisclosure}>
        <Text style={[styles.title, { color: colors.ink }]}>{copy.benefits} {membershipExpanded ? '−' : '+'}</Text>
      </TouchableOpacity>
      <View style={{ display: membershipExpanded ? 'flex' : 'none' }}>
        <TouchableOpacity accessibilityRole="button" style={[styles.outlineBtn, { borderColor: colors.primary }]} onPress={() => router.push('/membership-guide')}><Text style={[styles.outlineBtnText, { color: colors.primary }]}>{t('coachingGuideLink')}</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={[styles.outlineBtn, { borderColor: colors.primary }]} onPress={() => router.push('/free-practice')}><Text style={[styles.outlineBtnText, { color: colors.primary }]}>{t('freePracticeLink')}</Text></TouchableOpacity>
        <Text style={[styles.body, { color: colors.inkSoft }]}>{copy.free}</Text>
        {/* The one benefits list (plans.json): Essential, then what Premier adds. */}
        <Text style={[styles.tierName, { color: colors.ink, marginTop: 12 }]}>{t('tier.essentialName')}</Text>
        <BenefitList plan="essential" />
        <Text style={[styles.tierName, { color: colors.ink, marginTop: 12 }]}>{t('tier.premiumName')} · {tPlans('headings.premier')}</Text>
        <BenefitList plan="premier" />
        <Text style={[styles.body, { color: colors.inkSoft, marginTop: 10 }]}>{tPlans('notEmergency')}</Text>
        <Text style={[styles.body, { color: colors.inkSoft, marginTop: 10 }]}>{fillCoachingRates(copy.service, { rate: coachingRate.hourly, memberRate: COACHING_MEMBER_PRICE })}</Text>
        <TouchableOpacity accessibilityRole="button" style={[styles.outlineBtn, { borderColor: colors.primary }]} onPress={() => router.push('/safety-wallet')}><Text style={[styles.outlineBtnText, { color: colors.primary }]}>{copy.wallet}</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={[styles.outlineBtn, { borderColor: colors.primary }]} onPress={() => router.push('/crisis-mode')}><Text style={[styles.outlineBtnText, { color: colors.primary }]}>{copy.copilot}</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={[styles.outlineBtn, { borderColor: colors.primary }]} onPress={() => router.push('/chat')}><Text style={[styles.outlineBtnText, { color: colors.primary }]}>{copy.chat}</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={styles.manageLink} onPress={() => router.push('/settings')}><Text style={{ color: colors.primary }}>{copy.manage}</Text></TouchableOpacity>
        {(!subscriptionPrices.essential || !subscriptionPrices.premium) && !isAttached && <TouchableOpacity accessibilityRole="button" style={[styles.outlineBtn, { borderColor: colors.primary }]} onPress={retryPrices}><Text style={[styles.outlineBtnText, { color: colors.primary }]}>{copy.retryPrices}</Text></TouchableOpacity>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: supportCard,
  membershipDisclosure: { minHeight: 44, justifyContent: 'center' },
  title: { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  body: { fontSize: 13, lineHeight: 19 },
  tierName: { fontSize: 14, fontWeight: '700' },
  manageLink: { minHeight: 44, justifyContent: 'center', paddingVertical: 14 },
  outlineBtn: {
    ...buttonShape,
    borderWidth: 1.5,
    paddingVertical: 10,
    marginTop: 8,
  },
  outlineBtnText: { fontWeight: '700', fontSize: 14, lineHeight: 20, textAlign: 'center', flexShrink: 1 },
});
