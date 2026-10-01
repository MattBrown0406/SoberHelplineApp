import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import type { ForecastPause } from '../../lib/invitationForecast';
import { EngineCard, Kicker, PrimaryButton, SecondaryButton, TextLink } from './ui';

/**
 * Shown instead of the forecast and the "Prepare the invitation" prompt while
 * invitations are paused: their loved one is in treatment, coming home or in
 * recovery (the Today pathway stage), or someone in the family logged a yes.
 * Supportive, with the next useful step — never another invitation.
 */
export function PausedCard({
  reason,
  compact = false,
  openLabel,
  onOpen,
}: {
  reason: ForecastPause;
  /** Today: just the message and one action. */
  compact?: boolean;
  openLabel?: string;
  onOpen?: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('invitation');
  const router = useRouter();
  return (
    <EngineCard tone="calm">
      <Kicker color={colors.green}>{t('paused.kicker')}</Kicker>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t(`paused.${reason}.title`)}</Text>
      <Text style={[styles.body, { color: colors.ink }]}>{t(`paused.${reason}.body`)}</Text>
      {!compact && reason === 'after_yes' && (
        <SecondaryButton label={t('paused.openPlan')} onPress={() => router.push('/treatment-action-plan' as never)} />
      )}
      {!compact && reason === 'returning_home' && (
        <SecondaryButton label={t('paused.openHomecoming')} onPress={() => router.push('/homecoming-week' as never)} />
      )}
      {!compact && (reason === 'after_yes' ? (
        <TextLink label={t('paused.logUpdate')} onPress={() => router.push('/invitation-outcome' as never)} />
      ) : (
        // Phase pauses lift when their stage changes on Today's Recovery pathway card.
        <TextLink label={t('paused.updateStage')} onPress={() => router.push('/(tabs)' as never)} />
      ))}
      {compact && onOpen && openLabel && <PrimaryButton label={openLabel} onPress={onOpen} />}
    </EngineCard>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 19, lineHeight: 24, fontWeight: '900' },
  body: { fontSize: 14, lineHeight: 21, marginTop: 6 },
});
