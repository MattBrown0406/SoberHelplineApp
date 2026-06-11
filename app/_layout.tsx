import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { AccountProvider } from '../src/contexts/AccountContext';
import { ThemeProvider } from '../src/contexts/ThemeContext';
import { initI18n } from '../src/i18n';

export default function RootLayout() {
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    initI18n().then(() => setI18nReady(true));
  }, []);

  // Hold the render until i18n is ready (AsyncStorage read + init).
  // The OS splash screen covers this gap on cold start.
  if (!i18nReady) return null;

  return (
    <AccountProvider>
      <ThemeProvider>
        <Stack screenOptions={{ headerShown: false }} />
        <StatusBar style="auto" />
      </ThemeProvider>
    </AccountProvider>
  );
}
