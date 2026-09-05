import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { AppLogo } from '../../src/components/ui/AppLogo';

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return (
    <Text accessible={false} style={{ fontSize: 20, opacity: focused ? 1 : 0.72 }}>{emoji}</Text>
  );
}

export default function TabLayout() {
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
          flexShrink: 0,
          fontWeight: '700',
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('nav.today'),
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
          tabBarAccessibilityLabel: t('navPurpose.scripts'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="💬" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="boundaries"
        options={{
          title: t('nav.boundaries'),
          tabBarAccessibilityLabel: t('navPurpose.boundaries'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="🏰" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="tracker"
        options={{
          title: t('nav.tracker'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="📋" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="learn"
        options={{
          title: t('nav.learn'),
          tabBarAccessibilityLabel: t('navPurpose.learn'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="🧰" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="support"
        options={{
          title: t('nav.support'),
          tabBarAccessibilityLabel: t('navPurpose.support'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="🤝" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
