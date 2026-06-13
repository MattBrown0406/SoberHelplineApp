import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AccountProvider, useAccount } from '../src/contexts/AccountContext';
import { ThemeProvider } from '../src/contexts/ThemeContext';
import { initI18n } from '../src/i18n';
import { usePushNotifications } from '../src/hooks/usePushNotifications';
import { isOnboarded, subscribeOnboarded } from '../src/onboarding/state';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import i18n from '../src/i18n';

// Handles redirect between (auth) and (tabs) based on session state.
// Must be a child of AccountProvider so it can read useAccount().
function InitialLayout() {
  const { user, isLoading } = useAccount();
  const router = useRouter();
  const segments = useSegments();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  const nudgeTitle = i18n.t('settings:notifications.dailyNudgeTitle');
  const nudgeBody = i18n.t('settings:notifications.dailyNudgeBody');
  usePushNotifications(user?.id ?? null, nudgeTitle, nudgeBody);

  useEffect(() => {
    isOnboarded().then(setOnboarded);
    return subscribeOnboarded(() => setOnboarded(true));
  }, [user?.id]);

  useEffect(() => {
    if (isLoading || onboarded === null) return;
    const inAuth = segments[0] === '(auth)';
    const inOnboarding = segments[0] === '(onboarding)';
    if (!user && !inAuth) {
      router.replace('/(auth)/sign-in');
    } else if (user && !onboarded && !inOnboarding) {
      router.replace('/(onboarding)/welcome');
    } else if (user && onboarded && inAuth) {
      router.replace('/(tabs)');
    }
  }, [user, isLoading, onboarded, segments[0]]);

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    initI18n().then(() => setI18nReady(true));
  }, []);

  if (!i18nReady) return null;

  return (
    <ErrorBoundary>
      <AccountProvider>
        <ThemeProvider>
          <InitialLayout />
          <StatusBar style="auto" />
        </ThemeProvider>
      </AccountProvider>
    </ErrorBoundary>
  );
}
