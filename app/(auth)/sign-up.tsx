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
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { supabase } from '../../src/lib/supabase';
import { AppLogo } from '../../src/components/ui/AppLogo';

const TERMS_VERSION = '1.0';

export default function SignUpScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('auth');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  async function recordTermsConsent(accountId: string) {
    await supabase.from('consents').upsert({
      account_id: accountId,
      consent_key: '1',
      version: TERMS_VERSION,
      granted_at: new Date().toISOString(),
    }, { onConflict: 'account_id, consent_key' });
  }

  async function handleEmailSignUp() {
    setError(null);
    if (!acceptedTerms) {
      setError(t('signUp.errorTermsRequired'));
      return;
    }
    if (password.length < 8) {
      setError(t('signUp.errorWeakPassword'));
      return;
    }
    setLoading(true);
    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          terms_version: TERMS_VERSION,
          terms_accepted_at: new Date().toISOString(),
        },
      },
    });
    setLoading(false);

    if (err) {
      setError(
        err.message.toLowerCase().includes('already') || err.status === 422
          ? t('signUp.errorEmailTaken')
          : t('signUp.errorGeneric'),
      );
      return;
    }

    // Record Terms + Privacy consent (#1) once account row exists
    if (data.user) {
      const { data: account } = await supabase
        .from('accounts')
        .select('id')
        .eq('user_id', data.user.id)
        .single();
      if (account) await recordTermsConsent(account.id);
    }

    // Supabase requires email confirmation by default
    if (!data.session) {
      setCheckEmail(true);
    }
    // If email confirmation is disabled, onAuthStateChange fires → InitialLayout redirects
  }

  if (checkEmail) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
        <View style={styles.checkEmailWrap}>
          <Text style={styles.checkEmailIcon}>📬</Text>
          <Text style={[styles.checkEmailText, { color: colors.ink }]}>{t('signUp.checkEmail')}</Text>
          <Link href="/(auth)/sign-in" asChild>
            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.primary, marginTop: 24 }]}>
              <Text style={styles.primaryBtnText}>{t('signIn.submitButton')}</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </SafeAreaView>
    );
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
            <AppLogo size={72} />
            <Text style={[styles.appName, { color: colors.primary }]}>Sober Helpline</Text>
            <Text style={[styles.tagline, { color: colors.inkSoft }]}>{t('appTagline')}</Text>
          </View>

          <View style={[styles.card, { borderColor: colors.line }]}>
            <Text style={[styles.title, { color: colors.ink }]}>{t('signUp.title')}</Text>

            {error && (
              <View style={[styles.errorBox, { backgroundColor: colors.coralLight, borderColor: colors.coral }]}>
                <Text style={[styles.errorText, { color: colors.coral }]}>{error}</Text>
              </View>
            )}

            <View style={styles.row}>
              <View style={[styles.field, styles.flex1]}>
                <Text style={[styles.label, { color: colors.ink }]}>{t('signUp.firstNameLabel')}</Text>
                <TextInput
                  style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
                  placeholder={t('signUp.firstNamePlaceholder')}
                  placeholderTextColor={colors.inkSoft}
                  value={firstName}
                  onChangeText={setFirstName}
                  autoComplete="given-name"
                />
              </View>
              <View style={[styles.field, styles.flex1]}>
                <Text style={[styles.label, { color: colors.ink }]}>{t('signUp.lastNameLabel')}</Text>
                <TextInput
                  style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
                  placeholder={t('signUp.lastNamePlaceholder')}
                  placeholderTextColor={colors.inkSoft}
                  value={lastName}
                  onChangeText={setLastName}
                  autoComplete="family-name"
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.ink }]}>{t('signUp.emailLabel')}</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
                placeholder={t('signUp.emailPlaceholder')}
                placeholderTextColor={colors.inkSoft}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.ink }]}>{t('signUp.passwordLabel')}</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
                placeholder={t('signUp.passwordPlaceholder')}
                placeholderTextColor={colors.inkSoft}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete="new-password"
              />
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              onPress={handleEmailSignUp}
              disabled={loading || !email || !password || !firstName || !acceptedTerms}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>{t('signUp.submitButton')}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="checkbox"
              accessibilityState={{ checked: acceptedTerms }}
              style={styles.termsRow}
              onPress={() => setAcceptedTerms((value) => !value)}
            >
              <View style={[styles.termsCheckbox, { borderColor: colors.primary, backgroundColor: acceptedTerms ? colors.primary : colors.white }]}>
                <Text style={styles.termsCheckmark}>{acceptedTerms ? '✓' : ''}</Text>
              </View>
              <Text style={[styles.termsNote, { color: colors.inkSoft }]}>
                {t('signUp.termsNote')}{' '}
                <Text style={{ color: colors.primary, textDecorationLine: 'underline' }} onPress={(event) => { event.stopPropagation(); void Linking.openURL('https://soberhelpline.com/terms'); }}>
                  {t('signUp.termsLink')}
                </Text>
                {' '}{t('signUp.andText')}{' '}
                <Text style={{ color: colors.primary, textDecorationLine: 'underline' }} onPress={(event) => { event.stopPropagation(); void Linking.openURL('https://soberhelpline.com/privacy'); }}>
                  {t('signUp.privacyLink')}
                </Text>.
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.inkSoft }]}>{t('signUp.hasAccount')} </Text>
            <Link href="/(auth)/sign-in" asChild>
              <TouchableOpacity>
                <Text style={[styles.footerLink, { color: colors.primary }]}>{t('signUp.signInLink')}</Text>
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
    alignSelf: 'center',
    width: '100%',
    maxWidth: 480,
  },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 2 },
  errorBox: { borderWidth: 1, borderRadius: 10, padding: 10 },
  errorText: { fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 10 },
  flex1: { flex: 1 },
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
  termsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  termsCheckbox: { width: 22, height: 22, borderWidth: 1.5, borderRadius: 5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  termsCheckmark: { color: '#fff', fontWeight: '900' },
  termsNote: { flex: 1, fontSize: 11.5, lineHeight: 17 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 22,
  },
  footerText: { fontSize: 14 },
  footerLink: { fontSize: 14, fontWeight: '600' },
  checkEmailWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 12,
  },
  checkEmailIcon: { fontSize: 52 },
  checkEmailText: { fontSize: 16, lineHeight: 24, textAlign: 'center' },
});
