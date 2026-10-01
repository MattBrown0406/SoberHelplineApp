import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { openEmergencyLink } from '../../lib/emergencyLinks';

/**
 * Replaces the willingness window's invitation content ("This is the window…
 * we can leave now") for a member on her own safety-first path: after a
 * consequence she should not raise treatment alone. `unknown` is the
 * fail-closed variant when her safety answer could not be read.
 */
export function WindowSafetyNotice({ unknown = false, onRetry }: { unknown?: boolean; onRetry?: () => void } = {}) {
  const { colors } = useTheme();
  const { t } = useTranslation('invitation');
  const router = useRouter();
  return (
    <View accessibilityRole="summary" style={[styles.card, { backgroundColor: colors.coralLight, borderColor: colors.coral }]}>
      <Text style={[styles.kicker, { color: colors.coral }]}>{t('safety.kicker')}</Text>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
        {unknown ? t('windowSafety.unknownTitle') : t('windowSafety.title')}
      </Text>
      <Text style={[styles.body, { color: colors.ink }]}>{unknown ? t('windowSafety.unknownBody') : t('windowSafety.body')}</Text>
      <Text accessibilityRole="alert" style={[styles.danger, { color: colors.ink }]}>{t('safety.danger')}</Text>
      <View style={styles.actions}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('safety.call911')}
          onPress={() => openEmergencyLink('tel:911')}
          style={[styles.button, { backgroundColor: colors.coral }]}
        >
          <Text style={styles.buttonText}>{t('safety.call911')}</Text>
        </TouchableOpacity>
        {unknown ? (
          onRetry && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('windowSafety.retry')}
              onPress={onRetry}
              style={[styles.outline, { borderColor: colors.coral }]}
            >
              <Text style={[styles.outlineText, { color: colors.coral }]}>{t('windowSafety.retry')}</Text>
            </TouchableOpacity>
          )
        ) : (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('windowSafety.options')}
            onPress={() => router.push('/invitation-engine' as never)}
            style={[styles.outline, { borderColor: colors.coral }]}
          >
            <Text style={[styles.outlineText, { color: colors.coral }]}>{t('windowSafety.options')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 18, borderWidth: 2, padding: 18, marginBottom: 14 },
  kicker: { fontSize: 11, fontWeight: '900', letterSpacing: 1.1 },
  title: { fontSize: 20, lineHeight: 25, fontWeight: '900', marginTop: 5 },
  body: { fontSize: 14, lineHeight: 21, marginTop: 7 },
  danger: { fontSize: 13.5, lineHeight: 19, fontWeight: '800', marginTop: 10 },
  actions: { marginTop: 12, gap: 9 },
  button: { minHeight: 48, borderRadius: 99, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '900', textAlign: 'center' },
  outline: { minHeight: 48, borderRadius: 99, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  outlineText: { fontSize: 14, fontWeight: '900', textAlign: 'center' },
});
