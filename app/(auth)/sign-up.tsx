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
import { EmergencyActions } from '../../src/components/safety/EmergencyActions';
import { AppLogo } from '../../src/components/ui/AppLogo';
import { ConfirmEmailPanel } from '../../src/components/auth/ConfirmEmailPanel';
import { SIGN_UP_CONFIRM_REDIRECT_URL } from '../../src/lib/frontDoor';
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '../../src/config';

const TERMS_VERSION = '1.0';

function openLegalDocument(url: string) {
  // React Native Web's Linking.openURL replaces the signup page in the current
  // tab, discarding everything the person already typed. Keep legal documents
  // in a separate tab on web; native platforms still use the system browser.
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  void Linking.openURL(url);
}

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

  async function handleEmailSignUp() {
    if (loading) return;
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
    try {
      const { data, error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          // The confirmation link lands on a normal soberhelpline.com page.
          emailRedirectTo: SIGN_UP_CONFIRM_REDIRECT_URL,
          data: {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            terms_version: TERMS_VERSION,
            terms_accepted_at: new Date().toISOString(),
          },
        },
      });
      if (err) {
        setError(
          err.message.toLowerCase().includes('already') || err.status === 422
            ? t('signUp.errorEmailTaken')
            : t('signUp.errorGeneric'),
        );
        return;
      }

      // AccountContext records explicit metadata consent after authenticated
      // bootstrap. Confirmation-required signups cannot query account tables yet.

      // Email confirmation is required: show "Confirm your email", which signs
      // her in with what she just typed once she has tapped the link.
      if (!data.session) {
        setCheckEmail(true);
      }
      // If email confirmation is disabled, onAuthStateChange fires → InitialLayout redirects
    } catch {
      setError(t('signUp.errorGeneric'));
    } finally {
      setLoading(false);
    }
  }

  if (checkEmail) {
    // The password stays in this screen's memory only while this step is
    // open; the panel asks for it to be forgotten the moment it is not needed.
    return (
      <ConfirmEmailPanel
        email={email.trim()}
        password={password}
        onForgetPassword={() => setPassword('')}
        onUseDifferentEmail={() => {
          setPassword('');
          setError(null);
          setCheckEmail(false);
        }}
      />
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
              accessibilityRole="button"
              accessibilityLabel={t('signUp.submitButton')}
              accessibilityState={{ disabled: loading || !email || !password || !firstName || !acceptedTerms, busy: loading }}
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

            <View style={styles.termsRow}>
              <TouchableOpacity
                accessibilityRole="checkbox"
                accessibilityLabel={t('signUp.termsCheckboxLabel')}
                accessibilityState={{ checked: acceptedTerms }}
                aria-checked={acceptedTerms}
                style={styles.termsCheckboxButton}
                onPress={() => setAcceptedTerms((value) => !value)}
              >
                <View style={[styles.termsCheckbox, { borderColor: colors.primary, backgroundColor: acceptedTerms ? colors.primary : colors.white }]}>
                  <Text style={styles.termsCheckmark}>{acceptedTerms ? '✓' : ''}</Text>
                </View>
              </TouchableOpacity>
              <Text style={[styles.termsNote, { color: colors.inkSoft }]}>
                {t('signUp.termsNote')}{' '}
                <Text accessibilityRole="link" style={{ color: colors.primary, textDecorationLine: 'underline' }} onPress={(event) => { event.stopPropagation(); openLegalDocument(TERMS_OF_USE_URL); }}>
                  {t('signUp.termsLink')}
                </Text>
                {' '}{t('signUp.andText')}{' '}
                <Text accessibilityRole="link" style={{ color: colors.primary, textDecorationLine: 'underline' }} onPress={(event) => { event.stopPropagation(); openLegalDocument(PRIVACY_POLICY_URL); }}>
                  {t('signUp.privacyLink')}
                </Text>.
              </Text>
            </View>
          </View>

          {/* The first screen for a new person: the way to sign-in must be plain to see. */}
          <Link href="/(auth)/sign-in" asChild>
            <TouchableOpacity
              accessibilityRole="link"
              style={[styles.haveAccountBtn, { borderColor: colors.primary }]}
              activeOpacity={0.85}
            >
              <Text style={[styles.haveAccountText, { color: colors.primary }]}>{t('signUp.hasAccountButton')}</Text>
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
  termsCheckboxButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', margin: -10 },
  termsCheckbox: { width: 22, height: 22, borderWidth: 1.5, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  termsCheckmark: { color: '#fff', fontWeight: '900' },
  termsNote: { flex: 1, fontSize: 11.5, lineHeight: 17 },
  emergency: { marginTop: 28 },
  haveAccountBtn: {
    borderWidth: 1.5,
    borderRadius: 99,
    minHeight: 48,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 480,
    marginTop: 16,
  },
  haveAccountText: { fontSize: 15, fontWeight: '700' },
});
