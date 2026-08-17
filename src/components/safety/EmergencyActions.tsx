import React from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';

export function EmergencyActions({ prominent = false, offline = false }: { prominent?: boolean; offline?: boolean }) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('crisis');
  const isSpanish = (i18n.resolvedLanguage ?? i18n.language ?? 'en').startsWith('es');

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
          {isSpanish
            ? 'Aún se requiere servicio telefónico. Si un botón no conecta, ve a un lugar con señal celular o pide a alguien cercano que llame.'
            : 'Phone service is still required. If a button cannot connect, move to a place with cellular service or ask someone nearby to call.'}
        </Text>
      ) : null}
      <View style={styles.buttons}>
        <EmergencyButton label={t('emergency.call911')} url="tel:911" color={colors.coral} isSpanish={isSpanish} />
        <EmergencyButton label={t('emergency.call988')} url="tel:988" color={colors.primary} isSpanish={isSpanish} />
        <EmergencyButton label={t('emergency.text988')} url="sms:988" color={colors.primary} isSpanish={isSpanish} />
        <EmergencyButton label={t('emergency.poisonControl')} url="tel:18002221222" color={colors.secondary} isSpanish={isSpanish} />
      </View>
    </View>
  );
}

function EmergencyButton({ label, url, color, isSpanish }: { label: string; url: string; color: string; isSpanish: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.button, { borderColor: color }]}
      onPress={() => void Linking.openURL(url)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={isSpanish
        ? 'Abre el teléfono o la aplicación de mensajes; se requiere servicio para conectar'
        : 'Opens your phone or messaging app; service is required to connect'}
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
