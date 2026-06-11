import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AccountProvider } from '../src/contexts/AccountContext';
import { ThemeProvider } from '../src/contexts/ThemeContext';

export default function RootLayout() {
  return (
    <AccountProvider>
      <ThemeProvider>
        <Stack screenOptions={{ headerShown: false }} />
        <StatusBar style="auto" />
      </ThemeProvider>
    </AccountProvider>
  );
}
