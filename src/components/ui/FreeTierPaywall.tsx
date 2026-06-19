import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from './ScreenContainer';
import { useTheme } from '../../contexts/ThemeContext';

export function FreeTierPaywall() {
  const { colors } = useTheme();
  const { t } = useTranslation('support');
  const router = useRouter();

  return (
    <ScreenContainer backgroundColor={colors.cream} contentContainerStyle={styles.container}>
      <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
        <Text style={styles.lock}>🔒</Text>
        <Text style={[styles.heading, { color: colors.ink }]}>
          {t('paywall.heading')}
        </Text>
        <Text style={[styles.body, { color: colors.inkSoft }]}>
          {t('paywall.body')}
        </Text>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/(tabs)/support')}
          activeOpacity={0.85}
        >
          <Text style={styles.btnText}>{t('paywall.viewPlans')}</Text>
        </TouchableOpacity>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
