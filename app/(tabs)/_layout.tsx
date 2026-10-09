import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { AppLogo } from '../../src/components/ui/AppLogo';
import { useServerLocaleSync } from '../../src/hooks/useLanguage';

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return (
    <Text accessible={false} style={{ fontSize: 20, opacity: focused ? 1 : 0.72 }}>{emoji}</Text>
  );
}

export default function TabLayout() {
  // Which Monday call (and push language) the server uses follows this device's language.
  useServerLocaleSync();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('common');

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
          height: 64 + insets.bottom,
          paddingBottom: insets.bottom + 6,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          lineHeight: 14,
          flexShrink: 1,
          maxWidth: '100%',
          textAlign: 'center',
          fontWeight: '700',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('nav.today'),
          tabBarLabel: t('navShort.today'),
          tabBarAccessibilityLabel: t('nav.today'),
          tabBarIcon: ({ focused }) => (
            <View accessible={false} style={{ opacity: focused ? 1 : 0.72 }}>
              <AppLogo size={24} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="scripts"
        options={{
          title: t('nav.scripts'),
          tabBarLabel: t('navShort.scripts'),
          tabBarAccessibilityLabel: t('navPurpose.scripts'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="💬" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="boundaries"
        options={{
          title: t('nav.boundaries'),
          tabBarLabel: t('navShort.boundaries'),
          tabBarAccessibilityLabel: t('navPurpose.boundaries'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="🏰" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="tracker"
        options={{
          title: t('nav.tracker'),
          tabBarLabel: t('navShort.tracker'),
          tabBarAccessibilityLabel: t('nav.tracker'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="📋" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="learn"
        options={{
          title: t('nav.learn'),
          tabBarLabel: t('navShort.learn'),
          tabBarAccessibilityLabel: t('navPurpose.learn'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="🧰" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="support"
        options={{
          title: t('nav.support'),
          tabBarLabel: t('navShort.support'),
          tabBarAccessibilityLabel: t('navPurpose.support'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="🤝" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
