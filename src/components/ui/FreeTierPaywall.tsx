import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from './ScreenContainer';
import { BenefitList } from '../plans/BenefitList';
import { plansHref, type PlanSource } from '../../lib/membershipPath';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * Shown in place of a member feature. Says what Essential includes (the one
 * benefits list, plans.json), what stays free, and opens the plans screen.
 * `source` is the short label the plans screen logs for where she came from.
 */
export function FreeTierPaywall({ inline = false, feature, source }: { inline?: boolean; feature?: 'aiRehearsal'; source?: PlanSource }) {
  const { colors } = useTheme();
  const { t } = useTranslation('support');
  const { t: tPlans } = useTranslation('plans');
  const router = useRouter();
  const from: PlanSource = source ?? (feature === 'aiRehearsal' ? 'rehearsal_gate' : 'feature_gate');

  const card = (
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
      <Text style={styles.lock}>🔒</Text>
      <Text style={[styles.heading, { color: colors.ink }]}>
        {feature === 'aiRehearsal' ? t('practiceGate.heading') : tPlans('paywall.heading')}
      </Text>
      {feature === 'aiRehearsal' ? (
        <Text style={[styles.body, { color: colors.inkSoft }]}>{t('practiceGate.body')}</Text>
      ) : (
        <View style={styles.list}>
          <Text style={[styles.lead, { color: colors.inkSoft }]}>{tPlans('paywall.lead')}</Text>
          <BenefitList plan="essential" limit={4} />
        </View>
      )}
      {feature === 'aiRehearsal' ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('practiceGate.freeAction')} onPress={() => router.push('/free-practice')} style={styles.freeAction}>
          <Text style={{ color: colors.primary, textAlign: 'center' }}>{t('practiceGate.freeAction')}</Text>
        </TouchableOpacity>
      ) : <Text style={[styles.body, { color: colors.inkSoft }]}>{tPlans('paywall.free')}</Text>}
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('crisis.copilotButton')} onPress={() => router.push('/crisis-mode')} style={styles.freeAction}>
        <Text style={{ color: colors.primary }}>{t('crisis.copilotButton')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: colors.primary }]}
        accessibilityRole="button"
        accessibilityLabel={tPlans('seePlansLabel')}
        onPress={() => router.push(plansHref(from))}
        activeOpacity={0.85}
      >
        <Text style={styles.btnText}>{tPlans('seePlans')}</Text>
      </TouchableOpacity>
    </View>
  );

  // Inline: sit within an existing scroll (e.g. below the Today situation card).
  if (inline) return card;

  return (
    <ScreenContainer backgroundColor={colors.cream} contentContainerStyle={styles.container}>
      {card}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  // flexGrow, not flex: a taller-than-screen card (large text) must scroll.
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    borderWidth: 1,
    padding: 28,
    alignItems: 'center',
    gap: 12,
  },
  freeAction: { minHeight: 44, justifyContent: 'center', padding: 12 },
  list: { alignSelf: 'stretch' },
  lead: { fontSize: 13, fontWeight: '700' },
  lock: { fontSize: 40, marginBottom: 4 },
  heading: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  body: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  btn: {
    marginTop: 8,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: 'center',
    width: '100%',
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
