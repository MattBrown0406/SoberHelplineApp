import { useToolOpened } from '../src/hooks/useToolOpened';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { useTheme } from '../src/contexts/ThemeContext';
import { useAccount } from '../src/contexts/AccountContext';
import { useIAP } from '../src/hooks/useIAP';
import { useCoachingRate } from '../src/hooks/useCoachingRate';
import { COACHING_MEMBER_PRICE, fillCoachingRates } from '../src/lib/coachingPrice';
import { walletMembershipCopy } from '../src/content/walletMembershipCopy';
import { membershipGuideContent } from '../src/membershipGuide/content';
import { BenefitList } from '../src/components/plans/BenefitList';
import { plansHref } from '../src/lib/membershipPath';

export default function MembershipGuide() {
  useToolOpened('membership_guide');
  const router = useRouter();
  const { i18n } = useTranslation();
  const { t: tPlans } = useTranslation('plans');
  const { t: tSupport } = useTranslation('support');
  const { colors } = useTheme();
  const { user } = useAccount();
  const { prices, retryPrices } = useIAP();
  const coachingRate = useCoachingRate();
  const c = membershipGuideContent[i18n.language.startsWith('es') ? 'es' : 'en'];
  const membership = walletMembershipCopy(i18n.language);
  const body = (text: string) => <Text style={[styles.body, { color: colors.ink }]}>{text}</Text>;
  const heading = (text: string) => <Text accessibilityRole="header" style={[styles.heading, { color: colors.ink }]}>{text}</Text>;
  const button = (label: string, onPress: () => void) => (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={[styles.button, { backgroundColor: colors.primaryLight }]}>
      <Text style={[styles.buttonText, { color: colors.primary }]}>{label}</Text>
    </TouchableOpacity>
  );
  return <ScreenContainer scroll contentContainerStyle={styles.screen}>
    <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{c.title}</Text>
    <View style={[styles.card, { backgroundColor: colors.coralLight }]}>
      {body(c.safety)}
      {button(c.urgent, () => router.push('/crisis-mode'))}
      {button(c.wallet, () => router.push('/safety-wallet'))}
      {body(membership.free)}
    </View>
    {heading(c.introLabel)}
    {body(c.intro)}
    {button(c.practice, () => router.push('/free-practice'))}
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1 }]}>
      {heading(c.exampleTitle)}
      {body(c.exampleNote)}
      {heading(c.questionLabel)}
      {body(c.question)}
      {heading(c.responseLabel)}
      {body(c.response)}
    </View>
    {heading(c.options)}
    {/* The one benefits list (plans.json): Essential, then what Premier adds. */}
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1 }]}>
      {heading(tSupport('tier.essentialName'))}
      <BenefitList plan="essential" />
      {heading(tSupport('tier.premiumName'))}
      {body(tPlans('headings.premier'))}
      <BenefitList plan="premier" />
    </View>
    {body(c.timing)}
    {body(fillCoachingRates(membership.service, { rate: coachingRate.hourly, memberRate: COACHING_MEMBER_PRICE }))}
    {heading(c.prices)}
    {body(`Essential: ${prices.essential ? prices.essential + membership.month : membership.priceUnavailable}`)}
    {body(`Premier: ${prices.premium ? prices.premium + membership.month : membership.priceUnavailable}`)}
    {(!prices.essential || !prices.premium) && button(membership.retryPrices, retryPrices)}
    {body(user ? c.signedIn : c.signedOut)}
    {button(tPlans('seePlans'), () => router.push(plansHref('membership_guide')))}
  </ScreenContainer>;
}

const styles = StyleSheet.create({
  screen: { gap: 16, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: '700', flexShrink: 1 },
  heading: { fontSize: 19, fontWeight: '700', flexShrink: 1 },
  body: { fontSize: 16, lineHeight: 24, flexShrink: 1 },
  card: { padding: 16, borderRadius: 16, gap: 12, minWidth: 0 },
  button: { minHeight: 48, minWidth: 44, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, justifyContent: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600', textAlign: 'center', flexShrink: 1 },
});
