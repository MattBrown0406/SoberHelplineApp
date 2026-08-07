import React from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';

export function EmergencyActions({ prominent = false }: { prominent?: boolean }) {
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
      <Text style={[styles.title, { color: colors.coral }]}>{t('emergency.title')}</Text>
      <Text style={[styles.note, { color: colors.inkSoft }]}>{t('emergency.note')}</Text>
      <View style={styles.buttons}>
        <EmergencyButton label={t('emergency.call911')} url="tel:911" color={colors.coral} />
        <EmergencyButton label={t('emergency.call988')} url="tel:988" color={colors.primary} />
        <EmergencyButton label={t('emergency.text988')} url="sms:988" color={colors.primary} />
        <EmergencyButton label={t('emergency.poisonControl')} url="tel:18002221222" color={colors.secondary} />
      </View>
    </View>
  );
}

function EmergencyButton({ label, url, color }: { label: string; url: string; color: string }) {
  return (
    <TouchableOpacity
      style={[styles.button, { borderColor: color }]}
      onPress={() => void Linking.openURL(url)}
      accessibilityRole="button"
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
  button: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9 },
  buttonText: { fontSize: 13, fontWeight: '900' },
});
