import React, { useEffect } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  TouchableOpacity,
  StyleSheet,
  Linking,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../src/contexts/ThemeContext';
import { FEATURED_PROVIDER } from '../src/config';
import { logFunnelEvent } from '../src/lib/funnel';
import { MAX_CONTENT_WIDTH } from '../src/components/ui/ScreenContainer';
import { useAccount } from '../src/contexts/AccountContext';
import { useTreatmentActionPlan } from '../src/hooks/useTreatmentActionPlan';
import { treatmentActionProgress } from '../src/lib/treatmentActionPlan';

/**
 * Warm, low-pressure landing for the top funnel rung: planning an intervention
 * with Matt. Reached only when a family's situation is sustained-crisis — and
 * even then it's an invitation, never a push. Safety lines stay primary.
 */
export default function PlanInterventionScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('support');
  const { t: tActionPlan } = useTranslation('treatmentActionPlan');
  const router = useRouter();
  const { user } = useAccount();
  const { plan, loadState, saveState, reload } = useTreatmentActionPlan(user?.id ?? null);
  const actionProgress = treatmentActionProgress(plan);

  useEffect(() => {
    logFunnelEvent('intervention_viewed');
  }, []);

  const steps = [
    t('intervention.step1'),
    t('intervention.step2'),
    t('intervention.step3'),
  ];

  if (loadState === 'loading') {
    return (
      <SafeAreaView style={[styles.container, styles.loading, { backgroundColor: colors.cream }]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  if (loadState === 'error') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
        <View style={[styles.header, { borderBottomColor: colors.line }]}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
            <Text style={[styles.back, { color: colors.primary }]}>‹</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          <View accessibilityRole="alert" style={[styles.gateCard, { backgroundColor: colors.coralLight, borderColor: colors.coral }]}>
            <Text style={[styles.cardTitle, { color: colors.coral }]}>{tActionPlan('loadErrorTitle')}</Text>
            <Text style={[styles.stepText, { color: colors.ink }]}>{tActionPlan('loadErrorBody')}</Text>
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              onPress={() => void reload()}
            >
              <Text style={styles.primaryBtnText}>{tActionPlan('retryLoad')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.gateSupportNote, { color: colors.inkSoft }]}>{tActionPlan('gateSupportNote')}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.gateSecondary, { borderColor: colors.primary }]}
            onPress={() => router.push('/book-coaching')}
          >
            <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>{tActionPlan('gateSupportButton')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!actionProgress.ready || saveState !== 'saved') {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
        <View style={[styles.header, { borderBottomColor: colors.line }]}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button">
            <Text style={[styles.back, { color: colors.primary }]}>‹</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={[styles.eyebrow, { color: colors.coral }]}>{tActionPlan('kicker')}</Text>
          <Text style={[styles.title, { color: colors.ink }]}>
            {saveState === 'error' ? tActionPlan('saveError') : tActionPlan('gateTitle')}
          </Text>
          <Text style={[styles.intro, { color: colors.inkSoft }]}>
            {saveState === 'saving' ? tActionPlan('saving') : tActionPlan('warningBody')}
          </Text>
          <View style={[styles.gateCard, { backgroundColor: colors.coralLight, borderColor: colors.coral }]}>
            <Text style={[styles.gateProgress, { color: colors.coral }]}>
              {tActionPlan('progress', actionProgress)}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.primaryBtn, { backgroundColor: colors.coral }]}
              onPress={() => router.push('/treatment-action-plan' as never)}
            >
              <Text style={styles.primaryBtnText}>{tActionPlan('title')}</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.gateSupportNote, { color: colors.inkSoft }]}>{tActionPlan('gateSupportNote')}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.gateSecondary, { borderColor: colors.primary }]}
            onPress={() => router.push('/book-coaching')}
          >
            <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>{tActionPlan('gateSupportButton')}</Text>
          </TouchableOpacity>
          <View accessibilityRole="alert" style={[styles.gateExceptions, { borderLeftColor: colors.coral }]}>
            <Text style={[styles.actionPlanKicker, { color: colors.coral }]}>{tActionPlan('exceptionsTitle')}</Text>
            <Text style={[styles.stepText, { color: colors.ink }]}>{tActionPlan('spontaneous')}</Text>
            <Text style={[styles.stepText, { color: colors.ink }]}>{tActionPlan('emergency')}</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      <View style={[styles.header, { borderBottomColor: colors.line }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Text style={[styles.back, { color: colors.primary }]}>‹</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>
          {t('intervention.eyebrow')}
        </Text>
        <Text style={[styles.title, { color: colors.ink }]}>
          {t('intervention.title')}
        </Text>
        <Text style={[styles.intro, { color: colors.inkSoft }]}>
          {t('intervention.intro')}
        </Text>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={tActionPlan('title')}
          accessibilityHint={tActionPlan('warningBody')}
          style={[styles.actionPlanCard, { backgroundColor: colors.coralLight, borderColor: colors.coral }]}
          onPress={() => router.push('/treatment-action-plan' as never)}
          activeOpacity={0.85}
        >
          <Text style={[styles.actionPlanKicker, { color: colors.coral }]}>{tActionPlan('kicker')}</Text>
          <Text style={[styles.cardTitle, { color: colors.ink }]}>{tActionPlan('title')}</Text>
          <Text style={[styles.stepText, { color: colors.inkSoft }]}>{tActionPlan('warningBody')}</Text>
        </TouchableOpacity>

        {/* What it looks like */}
        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.cardTitle, { color: colors.ink }]}>
            {t('intervention.whatTitle')}
          </Text>
          {steps.map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={[styles.stepNum, { backgroundColor: colors.primaryLight }]}>
                <Text style={[styles.stepNumText, { color: colors.primary }]}>{i + 1}</Text>
              </View>
              <Text style={[styles.stepText, { color: colors.inkSoft }]}>{step}</Text>
            </View>
          ))}
        </View>

        {/* Provider card */}
        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.providerEyebrow, { color: colors.inkSoft }]}>
            {t('intervention.providerEyebrow')}
          </Text>
          <Text style={[styles.providerName, { color: colors.ink }]}>
            {FEATURED_PROVIDER.name}
          </Text>
          <Text style={[styles.providerCred, { color: colors.inkSoft }]}>
            {FEATURED_PROVIDER.credential} · {FEATURED_PROVIDER.credentialFull}
          </Text>
          <Text style={[styles.providerOrg, { color: colors.inkSoft }]}>
            {FEATURED_PROVIDER.org}
          </Text>

          <View style={styles.providerBtnRow}>
            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: colors.primary }]}
              onPress={() => void Linking.openURL(`mailto:${FEATURED_PROVIDER.email}`)}
              activeOpacity={0.85}
            >
              <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>
                {t('intervention.emailButton', { name: FEATURED_PROVIDER.name.split(' ')[0] })}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: colors.primary }]}
              onPress={() => void Linking.openURL(FEATURED_PROVIDER.web)}
              activeOpacity={0.85}
            >
              <Text style={[styles.secondaryBtnText, { color: colors.primary }]}>
                {t('intervention.webButton')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Primary CTA — low pressure */}
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
          onPress={() => {
            logFunnelEvent('intervention_started');
            router.push('/book-coaching');
          }}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>{t('intervention.primaryCta')}</Text>
        </TouchableOpacity>
        <Text style={[styles.primarySub, { color: colors.inkSoft }]}>
          {t('intervention.primaryCtaSub')}
        </Text>

        <Text style={[styles.reassure, { color: colors.inkSoft }]}>
          {t('intervention.reassure')}
        </Text>
        <Text style={[styles.crisisNote, { color: colors.inkSoft }]}>
          {t('intervention.crisisNote')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  back: { fontSize: 30, fontWeight: '600', marginTop: -4 },
  body: {
    padding: 24,
    alignSelf: 'center',
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    paddingBottom: 48,
  },
  eyebrow: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.6 },
  title: { fontSize: 23, fontWeight: '700', letterSpacing: -0.3, marginTop: 8 },
  intro: { fontSize: 14.5, lineHeight: 22, marginTop: 12, marginBottom: 8 },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    marginTop: 16,
  },
  actionPlanCard: { borderRadius: 18, borderWidth: 1.5, padding: 18, marginTop: 16 },
  actionPlanKicker: { fontSize: 10.5, fontWeight: '900', letterSpacing: 1, marginBottom: 7 },
  gateCard: { borderRadius: 18, borderWidth: 1.5, padding: 18, marginTop: 10 },
  gateProgress: { fontSize: 16, fontWeight: '900' },
  gateSupportNote: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 20 },
  gateSecondary: { borderRadius: 99, borderWidth: 1.5, paddingVertical: 13, alignItems: 'center', marginTop: 10 },
  gateExceptions: { borderLeftWidth: 4, paddingLeft: 13, marginTop: 24, gap: 7 },
  cardTitle: { fontSize: 15.5, fontWeight: '700', marginBottom: 12 },
  stepRow: { flexDirection: 'row', gap: 12, marginBottom: 12, alignItems: 'flex-start' },
  stepNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNumText: { fontSize: 13, fontWeight: '800' },
  stepText: { flex: 1, fontSize: 14, lineHeight: 20 },
  providerEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  providerName: { fontSize: 18, fontWeight: '700' },
  providerCred: { fontSize: 13, marginTop: 2 },
  providerOrg: { fontSize: 13, marginTop: 1 },
  providerBtnRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  secondaryBtn: {
    flex: 1,
    borderRadius: 99,
    borderWidth: 1.5,
    paddingVertical: 11,
    alignItems: 'center',
  },
  secondaryBtnText: { fontSize: 13.5, fontWeight: '700' },
  primaryBtn: {
    borderRadius: 99,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 24,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  primarySub: { fontSize: 12.5, textAlign: 'center', marginTop: 8 },
  reassure: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 24 },
  crisisNote: { fontSize: 11.5, textAlign: 'center', marginTop: 16 },
});
