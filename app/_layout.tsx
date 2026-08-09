import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AccountProvider, useAccount } from '../src/contexts/AccountContext';
import { ThemeProvider } from '../src/contexts/ThemeContext';
import { initI18n } from '../src/i18n';
import { usePushNotifications } from '../src/hooks/usePushNotifications';
import { isOnboarded, subscribeOnboarded } from '../src/onboarding/state';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { SafetyShortcut } from '../src/components/safety/SafetyShortcut';
import { getInitialLayoutState, isPushNavigationReady } from '../src/lib/authBootstrap';
import { addAppBreadcrumb } from '../src/lib/monitoring';
import { flushQueuedSupportCallReview, setReviewPromptRoute } from '../src/lib/reviewPrompt';

function ReviewPromptCoordinator() {
  const { user } = useAccount();
  const segments = useSegments();
  const routePath = segments.join('/');
  const routeRef = useRef(routePath);
  routeRef.current = routePath;
  setReviewPromptRoute(routePath);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flushOnToday = () => {
      if (!active || !isTodayRoute(routeRef.current)) return;
      timer = setTimeout(() => {
        if (active && isTodayRoute(routeRef.current)) {
          void flushQueuedSupportCallReview(user.id);
        }
      }, 800);
    };

    // Handles a member reopening the app after the external meeting app was
    // closed, as well as the normal background → foreground return.
    flushOnToday();
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const returnedToForeground = previousState !== 'active' && nextState === 'active';
      previousState = nextState;
      if (returnedToForeground) flushOnToday();
    });

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, [user?.id, routePath]);

  return null;
}

function isTodayRoute(routePath: string): boolean {
  return routePath === '(tabs)' || routePath === '(tabs)/index';
}

// Handles redirect between (auth) and (tabs) based on session state.
// Must be a child of AccountProvider so it can read useAccount().
function InitialLayout() {
  const { user, isLoading, isAuthenticated, accountError, refreshAccount } = useAccount();
  const { t } = useTranslation('common');
  const router = useRouter();
  const segments = useSegments();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  const layoutState = getInitialLayoutState({
    isAuthenticated,
    isLoading,
    hasUser: user !== null,
    onboardingReady: onboarded !== null,
    hasAccountError: accountError !== null,
  });
  usePushNotifications(
    user?.id ?? null,
    isPushNavigationReady({ layoutState, isAuthenticated, onboarded }),
  );

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
      if (!inAuth) {
        addAppBreadcrumb('auth.navigation_sign_in');
        router.replace('/(auth)/sign-in');
      }
      return;
    }
    if (onboarded === null) return;
    if (user && !onboarded && !inOnboarding) {
      addAppBreadcrumb('auth.navigation_onboarding');
      router.replace('/(onboarding)/welcome');
    } else if (user && onboarded && inAuth) {
      addAppBreadcrumb('auth.navigation_app');
      router.replace('/(tabs)');
    }
  }, [user, isAuthenticated, isLoading, onboarded, segments[0]]);

  if (layoutState === 'account-error') {
    return <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ flex: 1, padding: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F2E8', gap: 14 }}>
      <Text style={{ fontSize: 24, fontWeight: '900', textAlign: 'center', color: '#173B3F' }}>{t('accountLoad.title')}</Text>
      <Text style={{ fontSize: 16, lineHeight: 23, textAlign: 'center', color: '#52676A' }}>{t('accountLoad.body')}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ disabled: isLoading, busy: isLoading }}
        disabled={isLoading}
        onPress={() => void refreshAccount().catch(() => undefined)}
        style={{ minWidth: 180, borderRadius: 10, padding: 14, alignItems: 'center', backgroundColor: '#146C73' }}
      >
        {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '900' }}>{t('accountLoad.retry')}</Text>}
      </TouchableOpacity>
    </View>;
  }

  if (layoutState === 'bootstrap') {
    return (
      <View accessibilityLiveRegion="polite" style={{ flex: 1, padding: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F2E8', gap: 16 }}>
        <ActivityIndicator
          accessibilityRole="progressbar"
          accessibilityLabel={t('authBootstrap.title')}
          size="large"
          color="#146C73"
        />
        <Text style={{ fontSize: 24, fontWeight: '900', textAlign: 'center', color: '#173B3F' }}>
          {t('authBootstrap.title')}
        </Text>
        <Text style={{ maxWidth: 420, fontSize: 16, lineHeight: 23, textAlign: 'center', color: '#52676A' }}>
          {t('authBootstrap.body')}
        </Text>
      </View>
    );
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
          <ReviewPromptCoordinator />
          <SafetyShortcut />
          <StatusBar style="auto" />
        </ThemeProvider>
      </AccountProvider>
    </ErrorBoundary>
  );
}
