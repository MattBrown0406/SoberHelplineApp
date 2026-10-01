import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useAccount } from '../../src/contexts/AccountContext';
import { supabase } from '../../src/lib/supabase';
import { appAlert } from '../../src/lib/appAlert';
import { addAppBreadcrumb } from '../../src/lib/monitoring';
import { EmergencyActions } from '../../src/components/safety/EmergencyActions';

const MIN_PASSWORD = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Step = 'email' | 'code';

/**
 * Signed-out password reset: request-password-reset emails a one-time code
 * (Resend, soberhelpline.com); the code signs the member in via verifyOtp and
 * the new password is saved immediately.
 */
export default function ResetPasswordScreen() {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('auth');
  const router = useRouter();
  const { completeSignIn } = useAccount();
  const params = useLocalSearchParams<{ email?: string }>();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState(typeof params.email === 'string' ? params.email : '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode() {
    const address = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(address)) {
      setError(t('reset.errorEmail'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { error: fnError } = await supabase.functions.invoke('request-password-reset', {
        body: { email: address, lang: i18n.language?.startsWith('es') ? 'es' : 'en' },
      });
      if (fnError) {
        const status = (fnError as { context?: Response }).context?.status;
        if (status === 429) {
          // Several codes already went to this address this hour (perhaps
          // requested by someone else): the newest one in her inbox still works.
          setEmail(address);
          setStep('code');
          setError(t('reset.errorTooMany'));
          return;
        }
        setError(t('reset.errorSend'));
        return;
      }
      addAppBreadcrumb('auth.password_reset_requested');
      setEmail(address);
      setStep('code');
    } catch {
      setError(t('reset.errorSend'));
    } finally {
      setBusy(false);
    }
  }

  async function saveNewPassword() {
    const token = code.replace(/\s+/g, '');
    if (password.length < MIN_PASSWORD) {
      setError(t('reset.errorPasswordLength'));
      return;
    }
    if (password !== confirm) {
      setError(t('reset.errorPasswordMatch'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });
      if (verifyError || !data.session) {
        setError(t('reset.errorCode'));
        return;
      }
      const { data: updated, error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError || !updated.user) {
        // The verified code already signed the member in, and the app may have
        // moved on from this screen — say so somewhere that is always seen.
        setError(t('reset.errorSave'));
        appAlert(t('reset.errorSaveTitle'), t('reset.errorSaveSignedIn'));
        return;
      }
      addAppBreadcrumb('auth.password_reset_completed');
      appAlert(t('reset.successTitle'), t('reset.successBody'));
      completeSignIn(updated.user);
    } catch {
      setError(t('reset.errorSave'));
    } finally {
      setBusy(false);
    }
  }

  const canSave = code.replace(/\s+/g, '').length >= 6 && password.length > 0 && confirm.length > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={[styles.card, { borderColor: colors.line, backgroundColor: colors.white }]}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('reset.title')}</Text>

            {error ? (
              <View accessibilityLiveRegion="polite" style={[styles.errorBox, { backgroundColor: colors.coralLight, borderColor: colors.coral }]}>
                <Text style={[styles.errorText, { color: colors.coral }]}>{error}</Text>
              </View>
            ) : null}

            {step === 'email' ? (
              <>
                <Text style={[styles.body, { color: colors.inkSoft }]}>{t('reset.intro')}</Text>
                <Text style={[styles.label, { color: colors.ink }]}>{t('reset.emailLabel')}</Text>
                <TextInput
                  style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoComplete="email"
                  textContentType="emailAddress"
                  accessibilityLabel={t('reset.emailLabel')}
                />
                <PrimaryButton label={t('reset.sendButton')} busy={busy} disabled={!email.trim()} onPress={() => void requestCode()} color={colors.primary} />
              </>
            ) : (
              <>
                <Text style={[styles.body, { color: colors.inkSoft }]}>{t('reset.codeIntro', { email })}</Text>
                <Text style={[styles.label, { color: colors.ink }]}>{t('reset.codeLabel')}</Text>
                <TextInput
                  style={[styles.input, styles.codeInput, { borderColor: colors.line, color: colors.ink }]}
                  value={code}
                  onChangeText={setCode}
                  placeholder={t('reset.codePlaceholder')}
                  placeholderTextColor={colors.inkSoft}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  maxLength={10}
                  accessibilityLabel={t('reset.codeLabel')}
                />
                <Text style={[styles.label, { color: colors.ink }]}>{t('reset.passwordLabel')}</Text>
                <TextInput
                  style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
                  value={password}
                  onChangeText={setPassword}
                  placeholder={t('reset.passwordPlaceholder')}
                  placeholderTextColor={colors.inkSoft}
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  accessibilityLabel={t('reset.passwordLabel')}
                />
                <Text style={[styles.label, { color: colors.ink }]}>{t('reset.confirmLabel')}</Text>
                <TextInput
                  style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
                  value={confirm}
                  onChangeText={setConfirm}
                  secureTextEntry
                  autoComplete="new-password"
                  textContentType="newPassword"
                  accessibilityLabel={t('reset.confirmLabel')}
                />
                <PrimaryButton label={t('reset.saveButton')} busy={busy} disabled={!canSave} onPress={() => void saveNewPassword()} color={colors.primary} />
                <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => void requestCode()} style={styles.linkBtn}>
                  <Text style={[styles.linkText, { color: colors.primary }]}>{t('reset.resend')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => { setStep('email'); setCode(''); setError(null); }}
                  style={styles.linkBtn}
                >
                  <Text style={[styles.linkText, { color: colors.primary }]}>{t('reset.useDifferentEmail')}</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity accessibilityRole="link" onPress={() => router.replace('/(auth)/sign-in')} style={styles.linkBtn}>
              <Text style={[styles.linkText, { color: colors.inkSoft }]}>{t('reset.backToSignIn')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.emergency}>
            <EmergencyActions />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PrimaryButton({ label, busy, disabled, onPress, color }: {
  label: string; busy: boolean; disabled: boolean; onPress: () => void; color: string;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled: busy || disabled, busy }}
      style={[styles.primaryBtn, { backgroundColor: color, opacity: disabled ? 0.55 : 1 }]}
      onPress={onPress}
      disabled={busy || disabled}
      activeOpacity={0.85}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, padding: 20, justifyContent: 'center', maxWidth: 520, width: '100%', alignSelf: 'center' },
  card: { borderWidth: 1, borderRadius: 18, padding: 22 },
  title: { fontSize: 24, fontWeight: '900', marginBottom: 12 },
  body: { fontSize: 15, lineHeight: 22, marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '700', marginBottom: 6, marginTop: 6 },
  input: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginBottom: 8 },
  codeInput: { fontSize: 22, letterSpacing: 6, fontWeight: '800' },
  errorBox: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  errorText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  primaryBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 12, minHeight: 50, justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  linkBtn: { alignItems: 'center', paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  linkText: { fontSize: 14, fontWeight: '700' },
  emergency: { marginTop: 24 },
});
