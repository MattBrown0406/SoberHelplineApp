import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * The one header every tab starts with: the tab's name on the left (Today
 * shows its greeting there) and the same Settings button on the right, in the
 * same place on every tab, so the title does not jump when she switches tabs.
 *
 * The title wraps at large text sizes; it is never cut off.
 */
export function TabHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const router = useRouter();

  return (
    <View style={styles.row}>
      <View style={styles.titles}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: colors.inkSoft }]}>{subtitle}</Text> : null}
      </View>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('common:a11y.settings')}
        onPress={() => router.push('/settings')}
        activeOpacity={0.7}
        style={styles.settings}
      >
        <MaterialCommunityIcons
          name="cog-outline"
          size={24}
          color={colors.primary}
          accessible={false}
          importantForAccessibility="no"
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 8,
    marginBottom: 16,
  },
  titles: { flex: 1 },
  title: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  subtitle: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  // A full 44-point target around the 24-point icon; the negative margin puts
  // the icon itself on the screen's right edge, in line with the cards below.
  settings: {
    width: 44,
    minHeight: 44,
    marginRight: -10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
