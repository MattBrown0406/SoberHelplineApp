import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { supabase } from '../../src/lib/supabase';
import { useAccount } from '../../src/contexts/AccountContext';
import { addAppBreadcrumb, captureAppError } from '../../src/lib/monitoring';
import { EmergencyActions } from '../../src/components/safety/EmergencyActions';
import { ResendConfirmationNote } from '../../src/components/auth/ResendConfirmationNote';
import { AuthBrand } from '../../src/components/auth/AuthBrand';
import { isEmailNotConfirmed } from '../../src/lib/frontDoor';

export default function SignInScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('auth');
  const { completeSignIn } = useAccount();
  // "Confirm your email" hands over the address she already typed (never the password).
  const params = useLocalSearchParams<{ email?: string }>();

  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The address a sign-in was just refused for because it is not confirmed
  // yet: "Send the confirmation email again" is offered for that address, and
  // goes away when she types a different one. (The address only, in memory.)
  const [unconfirmedFor, setUnconfirmedFor] = useState<string | null>(null);
  const passwordInput = useRef<TextInput>(null);

  function changeEmail(value: string) {
    setEmail(value);
    if (unconfirmedFor !== null && value.trim() !== unconfirmedFor) setUnconfirmedFor(null);
  }

  async function handleEmailSignIn() {
    setError(null);
    setUnconfirmedFor(null);
    setLoading(true);
    let authenticated = false;
    addAppBreadcrumb('auth.sign_in_started');

    try {
      const typedEmail = email.trim();
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: typedEmail,
        password,
      });

      if (authError) {
        addAppBreadcrumb('auth.sign_in_rejected', 'warning');
        const unconfirmed = isEmailNotConfirmed(authError);
        // After the app was closed this is the only place a new link can be
        // asked for (the confirm step is gone, and links expire).
        if (unconfirmed) setUnconfirmedFor(typedEmail);
        setError(
          unconfirmed
            ? t('signIn.errorUnconfirmed')
            : authError.message.toLowerCase().includes('invalid') || authError.status === 400
              ? t('signIn.errorInvalid')
              : t('signIn.errorGeneric'),
        );
        return;
      }

      if (!data.user || !data.session) {
        addAppBreadcrumb('auth.sign_in_missing_session', 'error');
        setError(t('signIn.errorGeneric'));
        return;
      }

      authenticated = true;
      addAppBreadcrumb('auth.sign_in_completed');
      // Do not wait for the auth listener or optional subscription providers.
      // This immediately swaps the idle form for the authenticated bootstrap UI.
      completeSignIn(data.user);
    } catch (signInError) {
      addAppBreadcrumb('auth.sign_in_network_failed', 'error');
      captureAppError(signInError);
      setError(t('signIn.errorGeneric'));
    } finally {
      // On success the authenticated bootstrap screen owns progress feedback.
      // On failure restore the form so the user can safely retry.
      if (!authenticated) setLoading(false);
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kav}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo / brand: the same block as sign-up */}
          <AuthBrand />

          {/* Card */}
          <View style={[styles.card, { borderColor: colors.line }]}>
            <Text style={[styles.title, { color: colors.ink }]}>{t('signIn.title')}</Text>

            {error && (
              <View style={[styles.errorBox, { backgroundColor: colors.coralLight, borderColor: colors.coral }]}>
                <Text style={[styles.errorText, { color: colors.coral }]}>{error}</Text>
              </View>
            )}
            {/* Keyed by the address: another address starts with a fresh button. */}
            {unconfirmedFor ? <ResendConfirmationNote key={unconfirmedFor} email={unconfirmedFor} /> : null}

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.ink }]}>{t('signIn.emailLabel')}</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
                placeholder={t('signIn.emailPlaceholder')}
                placeholderTextColor={colors.inkSoft}
                value={email}
                onChangeText={changeEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                returnKeyType="next"
                onSubmitEditing={() => passwordInput.current?.focus()}
                submitBehavior="submit"
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.ink }]}>{t('signIn.passwordLabel')}</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
                placeholder={t('signIn.passwordPlaceholder')}
                placeholderTextColor={colors.inkSoft}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="current-password"
                ref={passwordInput}
                // Return on the keyboard signs in, exactly as the button does
                // (and only when the button itself could be pressed).
                returnKeyType="go"
                onSubmitEditing={() => { if (!loading && email && password) void handleEmailSignIn(); }}
              />
              <Link
                // On web the query string lands in browser history; prefill natively only.
                href={{ pathname: '/(auth)/reset-password', params: email.trim() && Platform.OS !== 'web' ? { email: email.trim() } : {} }}
                asChild
              >
                <TouchableOpacity accessibilityRole="link" hitSlop={8} style={styles.forgotLink}>
                  <Text style={[styles.forgotText, { color: colors.primary }]}>{t('signIn.forgotPassword')}</Text>
                </TouchableOpacity>
              </Link>
            </View>

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('signIn.submitButton')}
              accessibilityState={{ disabled: loading || !email || !password, busy: loading }}
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              onPress={handleEmailSignIn}
              disabled={loading || !email || !password}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>{t('signIn.submitButton')}</Text>
              )}
            </TouchableOpacity>

          </View>

          {/* The way to sign-up, as plain to see as the way back is on sign-up. */}
          <Link href="/(auth)/sign-up" asChild>
            <TouchableOpacity
              accessibilityRole="link"
              // One flat style object: <Link asChild> spreads the child's style.
              style={StyleSheet.flatten([styles.otherScreenBtn, { borderColor: colors.primary }])}
              activeOpacity={0.85}
            >
              <Text style={[styles.otherScreenText, { color: colors.primary }]}>
                <Text style={styles.otherScreenLead}>{t('signIn.noAccount')} </Text>
                {t('signIn.signUpLink')}
              </Text>
            </TouchableOpacity>
          </Link>

          <View style={styles.emergency}>
            <EmergencyActions />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  kav: { flex: 1 },
  scroll: { flexGrow: 1, padding: 24, paddingBottom: 40 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    shadowColor: '#22302f',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    gap: 14,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 480,
  },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 2 },
  errorBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  errorText: { fontSize: 13, lineHeight: 18 },
  field: { gap: 5 },
  label: { fontSize: 13, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 15,
  },
  primaryBtn: {
    borderRadius: 99,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 2,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 2,
  },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 12 },
  appleBtn: { width: '100%', height: 50 },
  emergency: { marginTop: 28 },
  forgotLink: { alignSelf: 'flex-end', marginTop: 8, minHeight: 32, justifyContent: 'center' },
  forgotText: { fontSize: 14, fontWeight: '700' },
  // The same outlined button as "I already have an account" on sign-up.
  otherScreenBtn: {
    borderWidth: 1.5,
    borderRadius: 99,
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 480,
    marginTop: 20,
  },
  otherScreenText: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  otherScreenLead: { fontWeight: '500' },
});
