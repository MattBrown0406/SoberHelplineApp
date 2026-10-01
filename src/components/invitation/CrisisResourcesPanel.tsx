import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { openEmergencyLink } from '../../lib/emergencyLinks';
import { FIELD_SETUP_STEP, type ScreenedField } from '../../lib/invitationScreen';
import { EngineCard, Kicker, SecondaryButton, TextLink } from './ui';

/**
 * Shown in place of invitation lines when what the family typed describes
 * violence, threats, weapons or self-harm (or the server's crisis screen
 * says so). Real help first: 911, 988, the DV hotline, and Matt. The member's
 * stored safety answer is not changed.
 */
export function CrisisResourcesPanel({
  field = 'unknown',
  onAcknowledge,
}: {
  field?: ScreenedField | 'unknown';
  /** "I'm safe right now": shows the lines for this visit, for this hit (patterns or moderation). */
  onAcknowledge?: () => void;
} = {}) {
  const { colors } = useTheme();
  const { t } = useTranslation('invitation');
  const router = useRouter();
  const setupStep = field === 'unknown' ? undefined : FIELD_SETUP_STEP[field];
  return (
    <EngineCard tone="alert">
      <Kicker color={colors.coral}>{t('crisis.kicker')}</Kicker>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('crisis.title')}</Text>
      <Text style={[styles.body, { color: colors.ink }]}>{t('crisis.body')}</Text>
      <View accessibilityRole="alert" style={[styles.danger, { borderLeftColor: colors.coral }]}>
        <Text style={[styles.dangerText, { color: colors.ink }]}>{t('crisis.danger')}</Text>
      </View>
      <View style={styles.row}>
        <Action label={t('crisis.call911')} color={colors.coral} onPress={() => openEmergencyLink('tel:911')} />
        <Action label={t('crisis.call988')} color={colors.primary} onPress={() => openEmergencyLink('tel:988')} />
        <Action label={t('crisis.text988')} color={colors.primary} onPress={() => openEmergencyLink('sms:988')} />
      </View>
      <Text style={[styles.section, { color: colors.ink }]}>{t('safety.hotlineTitle')}</Text>
      <View style={styles.row}>
        <Action label={t('safety.callHotline')} color={colors.primary} onPress={() => openEmergencyLink('tel:18007997233', '1-800-799-7233')} />
        <Action label={t('safety.textHotline')} color={colors.primary} onPress={() => openEmergencyLink('sms:88788', '88788')} />
      </View>
      <Action label={t('safety.mattButton')} color={colors.green} onPress={() => router.push('/situation-brief' as never)} />
      {/* Where the words came from, so she can review them — never a bypass. */}
      {field === 'observation' && <Text style={[styles.hint, { color: colors.inkSoft }]}>{t('crisis.editHint')}</Text>}
      {field === 'next_step' && (
        <>
          <Text style={[styles.hint, { color: colors.inkSoft }]}>{t('crisis.planHint')}</Text>
          <TextLink label={t('crisis.editPlan')} onPress={() => router.push('/treatment-action-plan' as never)} />
        </>
      )}
      {setupStep && (
        <>
          <Text style={[styles.hint, { color: colors.inkSoft }]}>{t('crisis.mapHint')}</Text>
          <TextLink
            label={t('crisis.editMap')}
            onPress={() => router.push({ pathname: '/invitation-setup', params: { step: setupStep } } as never)}
          />
        </>
      )}
      {onAcknowledge && (
        // After every resource above: a false positive is never a dead end,
        // but the help always comes first.
        <>
          <SecondaryButton label={t('crisis.acknowledge')} onPress={onAcknowledge} />
          <TextLink
            label={t('crisis.reviewSafety')}
            onPress={() => router.push({ pathname: '/invitation-setup', params: { step: 'safety' } } as never)}
          />
        </>
      )}
    </EngineCard>
  );
}

function Action({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.button, { borderColor: color }]}
    >
      <Text style={[styles.buttonText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 21, lineHeight: 26, fontWeight: '900' },
  body: { fontSize: 14, lineHeight: 21, marginTop: 8 },
  danger: { borderLeftWidth: 4, paddingLeft: 11, marginTop: 12 },
  dangerText: { fontSize: 14, lineHeight: 20, fontWeight: '800' },
  section: { fontSize: 13.5, lineHeight: 19, fontWeight: '900', marginTop: 14 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
    marginTop: 10,
    backgroundColor: '#ffffff',
  },
  buttonText: { fontSize: 14, fontWeight: '900' },
  hint: { fontSize: 12.5, lineHeight: 18, marginTop: 12 },
});
