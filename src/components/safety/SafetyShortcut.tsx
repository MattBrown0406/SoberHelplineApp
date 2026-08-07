import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAccount } from '../../contexts/AccountContext';
import { useTheme } from '../../contexts/ThemeContext';

/** A safety entry point that remains visible from every primary app tab. */
export function SafetyShortcut() {
  const router = useRouter();
  const segments = useSegments();
  const insets = useSafeAreaInsets();
  const { isAuthenticated, user } = useAccount();
  const { colors } = useTheme();
  const { t } = useTranslation('common');

  if (!isAuthenticated || !user || segments[0] !== '(tabs)') return null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('safetyShortcut.accessibility')}
        onPress={() => router.push('/safety-wallet')}
        activeOpacity={0.88}
        style={[
          styles.button,
          {
            backgroundColor: colors.coral,
            bottom: Math.max(76, insets.bottom + 62),
          },
        ]}
      >
        <Text style={styles.icon}>🛟</Text>
        <Text style={styles.label}>{t('safetyShortcut.label')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    right: 14,
    minHeight: 44,
    borderRadius: 24,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    shadowColor: '#22302f',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.24,
    shadowRadius: 7,
    elevation: 7,
  },
  icon: { fontSize: 16 },
  label: { color: '#fff', fontSize: 13.5, fontWeight: '900' },
});
