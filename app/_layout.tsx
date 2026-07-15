import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AccountProvider, useAccount } from '../src/contexts/AccountContext';
import { ThemeProvider } from '../src/contexts/ThemeContext';
import { initI18n } from '../src/i18n';
import { usePushNotifications } from '../src/hooks/usePushNotifications';
import { isOnboarded, subscribeOnboarded } from '../src/onboarding/state';
import { ErrorBoundary } from '../src/components/ErrorBoundary';

// Handles redirect between (auth) and (tabs) based on session state.
// Must be a child of AccountProvider so it can read useAccount().
function InitialLayout() {
  const { user, isLoading, isAuthenticated, accountError, refreshAccount } = useAccount();
  const { t } = useTranslation('common');
  const router = useRouter();
  const segments = useSegments();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  usePushNotifications(user?.id ?? null);

  useEffect(() => {
    if (!user?.id) {
      setOnboarded(null);
      return;
    }
    let active = true;
    void isOnboarded(user.id).then((value) => {
      if (active) setOnboarded(value);
    });
    const unsubscribe = subscribeOnboarded(user.id, () => setOnboarded(true));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [user?.id]);

  useEffect(() => {
    if (isLoading) return;
    const inAuth = segments[0] === '(auth)';
    const inOnboarding = segments[0] === '(onboarding)';
    if (!isAuthenticated) {
      if (!inAuth) router.replace('/(auth)/sign-in');
      return;
    }
    if (onboarded === null) return;
    if (user && !onboarded && !inOnboarding) {
      router.replace('/(onboarding)/welcome');
    } else if (user && onboarded && inAuth) {
      router.replace('/(tabs)');
    }
  }, [user, isAuthenticated, isLoading, onboarded, segments[0]]);

  if (isAuthenticated && accountError && !user) {
    return <View style={{ flex: 1, padding: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F2E8', gap: 14 }}>
      <Text style={{ fontSize: 24, fontWeight: '900', textAlign: 'center', color: '#173B3F' }}>{t('accountLoad.title')}</Text>
      <Text style={{ fontSize: 16, lineHeight: 23, textAlign: 'center', color: '#52676A' }}>{t('accountLoad.body')}</Text>
      <TouchableOpacity disabled={isLoading} onPress={() => void refreshAccount().catch(() => undefined)} style={{ minWidth: 180, borderRadius: 10, padding: 14, alignItems: 'center', backgroundColor: '#146C73' }}>
        {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '900' }}>{t('accountLoad.retry')}</Text>}
      </TouchableOpacity>
    </View>;
  }

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
