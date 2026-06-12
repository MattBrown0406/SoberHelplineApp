import React, { useState } from 'react';
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
import { Link } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { supabase } from '../../src/lib/supabase';

export default function SignInScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('auth');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEmailSignIn() {
    setError(null);
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (err) {
      setError(
        err.message.toLowerCase().includes('invalid') || err.status === 400
          ? t('signIn.errorInvalid')
          : t('signIn.errorGeneric'),
      );
    }
    // On success, AccountContext fires onAuthStateChange → InitialLayout redirects
  }

  async function handleAppleSignIn() {
    try {
      setError(null);
      const rawNonce = Math.random().toString(36).slice(2);
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
      );
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });
      const { error: err } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken!,
        nonce: rawNonce,
      });
      if (err) setError(t('signIn.errorGeneric'));
    } catch (e: unknown) {
      if ((e as { code?: string }).code !== 'ERR_REQUEST_CANCELED') {
        setError(t('signIn.errorGeneric'));
      }
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
            <Text style={[styles.logo, { color: colors.primary }]}>🏠</Text>
            <Text style={[styles.appName, { color: colors.primary }]}>Sober Helpline</Text>
            <Text style={[styles.tagline, { color: colors.inkSoft }]}>{t('appTagline')}</Text>
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

            {Platform.OS === 'ios' && (
              <>
                <View style={styles.dividerRow}>
                  <View style={[styles.dividerLine, { backgroundColor: colors.line }]} />
                  <Text style={[styles.dividerText, { color: colors.inkSoft }]}>{t('signIn.orDivider')}</Text>
                  <View style={[styles.dividerLine, { backgroundColor: colors.line }]} />
                </View>
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
                  cornerRadius={99}
                  style={styles.appleBtn}
                  onPress={handleAppleSignIn}
                />
              </>
            )}
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
  brand: { alignItems: 'center', marginTop: 32, marginBottom: 28 },
  logo: { fontSize: 48, marginBottom: 8 },
  appName: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5 },
  tagline: { fontSize: 13, marginTop: 4 },
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
