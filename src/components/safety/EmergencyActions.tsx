import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { openEmergencyLink } from '../../lib/emergencyLinks';

export function EmergencyActions({ prominent = false, offline = false }: { prominent?: boolean; offline?: boolean }) {
  const { colors } = useTheme();
  const { t } = useTranslation('crisis');

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: prominent ? colors.coralLight : colors.white,
          borderColor: colors.coral,
        },
      ]}
    >
      <Text accessibilityRole="header" style={[styles.title, { color: colors.coral }]}>{t('emergency.title')}</Text>
      <Text style={[styles.note, { color: colors.inkSoft }]}>{t('emergency.note')}</Text>
      {offline ? (
        <Text accessibilityLiveRegion="polite" style={[styles.offlineNote, { color: colors.ink }]}>
          {t('emergency.offlineNote')}
        </Text>
      ) : null}
      <View style={styles.buttons}>
        <EmergencyButton label={t('emergency.call911')} url="tel:911" color={colors.coral} hint={t('emergency.buttonHint')} />
        <EmergencyButton label={t('emergency.call988')} url="tel:988" color={colors.primary} hint={t('emergency.buttonHint')} />
        <EmergencyButton label={t('emergency.text988')} url="sms:988" color={colors.primary} hint={t('emergency.buttonHint')} />
        <EmergencyButton label={t('emergency.poisonControl')} url="tel:18002221222" displayNumber="1-800-222-1222" color={colors.secondary} hint={t('emergency.buttonHint')} />
      </View>
    </View>
  );
}

function EmergencyButton({ label, url, displayNumber, color, hint }: { label: string; url: string; displayNumber?: string; color: string; hint: string }) {
  return (
    <TouchableOpacity
      style={[styles.button, { borderColor: color }]}
      onPress={() => openEmergencyLink(url, displayNumber)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
    >
      <Text style={[styles.buttonText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: 18, padding: 15, marginBottom: 14 },
  title: { fontSize: 17, fontWeight: '900', marginBottom: 3 },
  note: { fontSize: 13, lineHeight: 18 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 11 },
  offlineNote: { fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 8 },
  button: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9, minHeight: 44, justifyContent: 'center' },
  buttonText: { fontSize: 13, fontWeight: '900' },
});
