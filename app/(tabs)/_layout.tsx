import type { ComponentProps } from 'react';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StyleSheet, Text } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { TAB_BAR_HEIGHT } from '../../src/components/ui/ScreenContainer';
import { useServerLocaleSync } from '../../src/hooks/useLanguage';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * The four tabs, in order, with one icon set: the outline glyph, and the
 * filled one when the tab is selected.
 *
 * Boundaries now lives inside Practice and the Tracker is a pushed screen
 * (4.4). The old Boundaries tab route stays registered but hidden
 * (`href: null`), so `/(tabs)/boundaries` links still resolve and forward to
 * Practice's Boundaries part. There is deliberately NO tab named `tracker`:
 * a tab with that name captures `router.push('/tracker')` (navigation picks
 * the nearest navigator holding a route of that name) and the Tracker screen
 * at `app/tracker.tsx` would never open.
 */
const TAB_ICONS = {
  index: { outline: 'lighthouse', filled: 'lighthouse-on' },
  scripts: { outline: 'forum-outline', filled: 'forum' },
  learn: { outline: 'toolbox-outline', filled: 'toolbox' },
  support: { outline: 'handshake-outline', filled: 'handshake' },
} satisfies Record<string, { outline: IconName; filled: IconName }>;

type TabName = keyof typeof TAB_ICONS;

function TabIcon({ tab, focused, color }: { tab: TabName; focused: boolean; color: string }) {
  const { outline, filled } = TAB_ICONS[tab];
  return (
    <MaterialCommunityIcons
      accessible={false}
      name={focused ? filled : outline}
      size={24}
      color={color}
    />
  );
}

/**
 * The tab's name, always whole and on one line. Four tabs leave each name
 * room at its own size; only at the largest text sizes, or a narrow window,
 * does a name shrink a little instead of being cut off.
 */
function TabLabel({ label, color, beside }: { label: string; color: string; beside: boolean }) {
  return (
    <Text
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.85}
      maxFontSizeMultiplier={1.3}
      style={[styles.label, beside ? styles.labelBeside : styles.labelBelow, { color }]}
    >
      {label}
    </Text>
  );
}

export default function TabLayout() {
  // Which Monday call (and push language) the server uses follows this device's language.
  useServerLocaleSync();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('common');

  // The word on the tab is the word used for that screen's title (navShort mirrors nav).
  const tab = (name: TabName, label: string) => ({
    tabBarLabel: ({ color, position }: { color: string; position: string }) => (
      <TabLabel label={label} color={color} beside={position === 'beside-icon'} />
    ),
    tabBarIcon: ({ focused, color }: { focused: boolean; color: string }) => (
      <TabIcon tab={name} focused={focused} color={color} />
    ),
  });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.inkSoft,
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopColor: colors.line,
          borderTopWidth: 1,
          paddingTop: 6,
          height: TAB_BAR_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom + 6,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('nav.today'),
          tabBarAccessibilityLabel: t('nav.today'),
          ...tab('index', t('navShort.today')),
        }}
      />
      <Tabs.Screen
        name="scripts"
        options={{
          title: t('nav.scripts'),
          tabBarAccessibilityLabel: t('navPurpose.scripts'),
          ...tab('scripts', t('navShort.scripts')),
        }}
      />
      <Tabs.Screen
        name="learn"
        options={{
          title: t('nav.learn'),
          tabBarAccessibilityLabel: t('navPurpose.learn'),
          ...tab('learn', t('navShort.learn')),
        }}
      />
      <Tabs.Screen
        name="support"
        options={{
          title: t('nav.support'),
          tabBarAccessibilityLabel: t('navPurpose.support'),
          ...tab('support', t('navShort.support')),
        }}
      />
      {/* Hidden: old links only. Boundaries opens Practice's Boundaries part. */}
      <Tabs.Screen name="boundaries" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    lineHeight: 14,
    textAlign: 'center',
    fontWeight: '700',
  },
  // Under the icon (phones).
  labelBelow: { alignSelf: 'stretch' },
  // Beside the icon (iPad, wide windows).
  labelBeside: { flexShrink: 1, marginStart: 6, marginEnd: 10 },
});
