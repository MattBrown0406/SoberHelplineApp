import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { AppLogo } from '../ui/AppLogo';

/**
 * The same mark, name and tagline at the top of sign-up and sign-in, so the
 * two screens read as one front door.
 */
export function AuthBrand() {
  const { colors } = useTheme();
  const { t } = useTranslation('auth');
  return (
    <View style={styles.brand}>
      <AppLogo size={72} />
      <Text style={[styles.appName, { color: colors.primary }]}>{t('appName')}</Text>
      <Text style={[styles.tagline, { color: colors.inkSoft }]}>{t('appTagline')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', marginTop: 32, marginBottom: 28 },
  appName: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5, marginTop: 12, textAlign: 'center' },
  tagline: { fontSize: 14, lineHeight: 20, marginTop: 4, textAlign: 'center' },
});
