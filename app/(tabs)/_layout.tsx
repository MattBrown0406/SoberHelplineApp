import { Tabs } from 'expo-router';
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
        },
        tabBarLabelStyle: {
          fontSize: 11,
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
          tabBarIcon: ({ focused }) => <TabIcon emoji="💬" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="boundaries"
        options={{
          title: t('nav.boundaries'),
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
          tabBarIcon: ({ focused }) => <TabIcon emoji="🧰" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="support"
        options={{
          title: t('nav.support'),
          tabBarIcon: ({ focused }) => <TabIcon emoji="🤝" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
