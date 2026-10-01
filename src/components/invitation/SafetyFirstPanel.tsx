import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { openEmergencyLink } from '../../lib/emergencyLinks';
import { EngineCard, Kicker } from './ui';

/**
 * The safety-first path. Shown only to the member who answered 'serious' on
 * her own safety screen — never because of a relative's answer, and on every
 * tier, because safety is never paywalled. It never offers invitation
 * windows; it points to 911, the National Domestic Violence Hotline, and a
 * professional (Matt) to plan any next step.
 */
export function SafetyFirstPanel() {
  const { colors } = useTheme();
  const { t } = useTranslation('invitation');
  const router = useRouter();

  return (
    <EngineCard tone="alert">
      <Kicker color={colors.coral}>{t('safety.kicker')}</Kicker>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('safety.title')}</Text>
      <Text style={[styles.body, { color: colors.ink }]}>
        {t('safety.body')}
      </Text>

      <View accessibilityRole="alert" style={[styles.danger, { borderLeftColor: colors.coral }]}>
        <Text style={[styles.dangerText, { color: colors.ink }]}>{t('safety.danger')}</Text>
      </View>

      <EmergencyButton label={t('safety.call911')} color={colors.coral} onPress={() => openEmergencyLink('tel:911')} />

      <Text style={[styles.sectionTitle, { color: colors.ink }]}>{t('safety.hotlineTitle')}</Text>
      <View style={styles.row}>
        <EmergencyButton
          label={t('safety.callHotline')}
          color={colors.primary}
          onPress={() => openEmergencyLink('tel:18007997233', '1-800-799-7233')}
        />
        <EmergencyButton
          label={t('safety.textHotline')}
          color={colors.primary}
          onPress={() => openEmergencyLink('sms:88788', '88788')}
        />
      </View>

      <Text style={[styles.sectionTitle, { color: colors.ink }]}>{t('safety.mattTitle')}</Text>
      <Text style={[styles.body, { color: colors.inkSoft }]}>{t('safety.mattBody')}</Text>
      <EmergencyButton
        label={t('safety.mattButton')}
        color={colors.green}
        onPress={() => router.push('/situation-brief' as never)}
      />
    </EngineCard>
  );
}

function EmergencyButton({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
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
  title: { fontSize: 22, lineHeight: 27, fontWeight: '900' },
  body: { fontSize: 14, lineHeight: 21, marginTop: 8 },
  danger: { borderLeftWidth: 4, paddingLeft: 11, marginTop: 12 },
  dangerText: { fontSize: 14, lineHeight: 20, fontWeight: '800' },
  sectionTitle: { fontSize: 13.5, lineHeight: 19, fontWeight: '900', marginTop: 16 },
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
});
