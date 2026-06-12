import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AccountProvider, useAccount } from '../src/contexts/AccountContext';
import { ThemeProvider } from '../src/contexts/ThemeContext';
import { initI18n } from '../src/i18n';
import { usePushNotifications } from '../src/hooks/usePushNotifications';
import i18n from '../src/i18n';

// Handles redirect between (auth) and (tabs) based on session state.
// Must be a child of AccountProvider so it can read useAccount().
function InitialLayout() {
  const { user, isLoading } = useAccount();
  const router = useRouter();
  const segments = useSegments();

  const nudgeTitle = i18n.t('settings:notifications.dailyNudgeTitle');
  const nudgeBody = i18n.t('settings:notifications.dailyNudgeBody');
  usePushNotifications(user?.id ?? null, nudgeTitle, nudgeBody);

  useEffect(() => {
    if (isLoading) return;
    const inAuth = segments[0] === '(auth)';
    if (!user && !inAuth) {
      router.replace('/(auth)/sign-in');
    } else if (user && inAuth) {
      router.replace('/(tabs)');
    }
  }, [user, isLoading]);

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    initI18n().then(() => setI18nReady(true));
  }, []);

  if (!i18nReady) return null;

  return (
    <AccountProvider>
      <ThemeProvider>
        <InitialLayout />
        <StatusBar style="auto" />
      </ThemeProvider>
    </AccountProvider>
  );
}
