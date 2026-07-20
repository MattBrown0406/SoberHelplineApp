import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { supabase } from '../../src/lib/supabase';
import { useAccount } from '../../src/contexts/AccountContext';
import { addAppBreadcrumb, captureAppError } from '../../src/lib/monitoring';
const LOGO = require('../../assets/images/logo.png');

export default function SignInScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('auth');
  const { completeSignIn } = useAccount();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEmailSignIn() {
    setError(null);
    setLoading(true);
    let authenticated = false;
    addAppBreadcrumb('auth.sign_in_started');

    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        addAppBreadcrumb('auth.sign_in_rejected', 'warning');
        setError(
          authError.message.toLowerCase().includes('invalid') || authError.status === 400
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
          {/* Logo / brand */}
          <View style={styles.brand}>
            <Image source={LOGO} style={styles.logoImg} resizeMode="contain" />
          </View>

          {/* Card */}
          <View style={[styles.card, { borderColor: colors.line }]}>
            <Text style={[styles.title, { color: colors.ink }]}>{t('signIn.title')}</Text>

            {error && (
              <View style={[styles.errorBox, { backgroundColor: colors.coralLight, borderColor: colors.coral }]}>
                <Text style={[styles.errorText, { color: colors.coral }]}>{error}</Text>
              </View>
            )}

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.ink }]}>{t('signIn.emailLabel')}</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
                placeholder={t('signIn.emailPlaceholder')}
                placeholderTextColor={colors.inkSoft}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
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
              />
            </View>

            <TouchableOpacity
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

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.inkSoft }]}>{t('signIn.noAccount')} </Text>
            <Link href="/(auth)/sign-up" asChild>
              <TouchableOpacity>
                <Text style={[styles.footerLink, { color: colors.primary }]}>{t('signIn.signUpLink')}</Text>
              </TouchableOpacity>
            </Link>
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
  brand: { alignItems: 'center', marginTop: 24, marginBottom: 20 },
  logoImg: { width: 260, height: 120, borderRadius: 14 },
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
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 22,
  },
  footerText: { fontSize: 14 },
  footerLink: { fontSize: 14, fontWeight: '600' },
});
