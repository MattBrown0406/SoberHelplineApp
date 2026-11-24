import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { buttonShape } from '../ui/Button';
import { normalizeRecoveryPhase, pathwayDaySlot, RECOVERY_PHASE_ROUTE } from '../../lib/recoveryPathway';

interface Props {
  stage: string | null | undefined;
  status: string | null | undefined;
  loading?: boolean;
}

/**
 * Her path's next step, for Today's next-step slot when nothing else has one:
 * where she is (the loved one's phase), one thing to do today, and the one
 * button for that phase. The whole path (change the phase, what to avoid,
 * what may be normal) is "Your path" under "More for you". Draws nothing
 * while the phase loads, so the slot does not show a guess.
 */
export function PathNextStepCard({ stage, status, loading = false }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('today');
  const router = useRouter();
  if (loading) return null;
  const phase = normalizeRecoveryPhase(stage, status);
  const slot = pathwayDaySlot(new Date());
  return (
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
      <Text style={[styles.eyebrow, { color: colors.primary }]}>{t('pathStep.eyebrow')}</Text>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
        {t('pathStep.title', { phase: t(`pathway.phases.${phase}.label`) })}
      </Text>
      <Text style={[styles.body, { color: colors.inkSoft }]}>{t(`pathway.phases.${phase}.do.${slot}`)}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => router.push(RECOVERY_PHASE_ROUTE[phase] as never)}
        style={[styles.button, { borderColor: colors.primary }]}
        activeOpacity={0.8}
      >
        <Text style={[styles.buttonText, { color: colors.primary }]}>{t(`pathway.phases.${phase}.cta`)}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 1, padding: 16, marginBottom: 12 },
  eyebrow: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.7, textTransform: 'uppercase' },
  title: { fontSize: 18, lineHeight: 23, fontWeight: '700', marginTop: 4 },
  body: { fontSize: 14, lineHeight: 20, marginTop: 6, marginBottom: 12 },
  button: { ...buttonShape, borderWidth: 1.5 },
  buttonText: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
});
