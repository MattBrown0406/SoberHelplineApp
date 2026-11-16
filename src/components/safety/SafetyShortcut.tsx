import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useAccount } from '../../contexts/AccountContext';
import { useTheme } from '../../contexts/ThemeContext';
import { SAFETY_SHORTCUT_GAP, SAFETY_SHORTCUT_TARGET, TAB_BAR_HEIGHT } from '../ui/ScreenContainer';

// The root layout imports this file, so the icon font (this button's lifebuoy
// and the tab bar's icons) starts loading at launch instead of on first paint.
// The word "Safety" shows either way.
MaterialCommunityIcons.loadFont().catch(() => {});

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
      {/* The tap target is 44pt; the pill drawn inside it is smaller, so it covers less of the screen. */}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('safetyShortcut.accessibility')}
        onPress={() => router.push('/safety-wallet' as never)}
        activeOpacity={0.88}
        style={[
          styles.target,
          // Always above the tab bar, whatever the device's bottom inset.
          { bottom: TAB_BAR_HEIGHT + insets.bottom + SAFETY_SHORTCUT_GAP, right: 12 + insets.right },
        ]}
      >
        <View style={[styles.pill, { backgroundColor: colors.coral }]}>
          <MaterialCommunityIcons accessible={false} name="lifebuoy" size={16} color={colors.white} />
          <Text maxFontSizeMultiplier={1.3} style={[styles.label, { color: colors.white }]}>
            {t('safetyShortcut.label')}
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  target: {
    position: 'absolute',
    minHeight: SAFETY_SHORTCUT_TARGET,
    minWidth: SAFETY_SHORTCUT_TARGET,
    justifyContent: 'center',
  },
  pill: {
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 11,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    shadowColor: '#22302f',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 5,
    elevation: 5,
  },
  label: { fontSize: 13, fontWeight: '800' },
});
