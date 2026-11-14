import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { User } from '@supabase/supabase-js';
import { useTheme } from '../../contexts/ThemeContext';
import { useAccount } from '../../contexts/AccountContext';
import { supabase } from '../../lib/supabase';
import { addAppBreadcrumb, captureAppError } from '../../lib/monitoring';
import {
  PASSWORD_MEMORY_BACKGROUND_LIMIT_MS,
  SIGN_UP_CONFIRM_REDIRECT_URL,
  confirmSignInOutcome,
  resendSecondsLeft,
  shouldAutoTryOnReturn,
  shouldForgetPassword,
  type ConfirmSignInOutcome,
} from '../../lib/frontDoor';
import { EmergencyActions } from '../safety/EmergencyActions';

type Notice = 'notYet' | 'checkFailed' | 'resent' | 'resendFailed' | 'passwordForgotten' | 'alreadyHasAccount';

interface Props {
  /** The address she typed on the sign-up form. */
  email: string;
  /**
   * The password she typed, owned by the sign-up screen's state. Memory only:
   * it is never stored, logged or put in a route, and this panel asks the
   * screen to forget it as soon as it is no longer needed.
   */
  password: string;
  /** Clears the password from the sign-up screen's memory. */
  onForgetPassword: () => void;
  /** Back to the form (the screen forgets the password on the way). */
  onUseDifferentEmail: () => void;
}

/**
 * After sign-up: "Confirm your email". She opens the email, taps the link (it
 * opens a soberhelpline.com page) and comes back; the app then signs her in
 * with what she already typed, so she never fills in the form twice.
 */
export function ConfirmEmailPanel({ email, password, onForgetPassword, onUseDifferentEmail }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('auth');
  const router = useRouter();
  const { completeSignIn } = useAccount();

  const [busy, setBusy] = useState<'checking' | 'resending' | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  // Sign-up sent the first email a moment ago.
  const [lastSentAt, setLastSentAt] = useState<number | null>(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  const passwordRef = useRef(password);
  passwordRef.current = password;
  const forgetRef = useRef(onForgetPassword);
  forgetRef.current = onForgetPassword;
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const secondsLeft = resendSecondsLeft(lastSentAt, now);
  useEffect(() => {
    if (resendSecondsLeft(lastSentAt, Date.now()) <= 0) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (resendSecondsLeft(lastSentAt, current) <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [lastSentAt]);

  // One sign-in with what she already typed. Used by the button and, once per
  // return from the background, by the AppState listener below.
  const trySignIn = useRef(async () => {});
  trySignIn.current = async () => {
    const typedPassword = passwordRef.current;
    if (busyRef.current || !typedPassword) return;
    busyRef.current = true;
    setBusy('checking');
    addAppBreadcrumb('auth.confirm_sign_in_started');
    let outcome: ConfirmSignInOutcome = 'failed';
    let sessionUser: User | null = null;
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: typedPassword });
      outcome = confirmSignInOutcome({ error, hasSession: !!data?.user && !!data?.session });
      sessionUser = data?.user ?? null;
    } catch (signInError) {
      addAppBreadcrumb('auth.confirm_sign_in_network_failed', 'error');
      captureAppError(signInError);
    }
    if (outcome === 'signed-in' && sessionUser) {
      // Signed in: the password has done its job.
      forgetRef.current();
      addAppBreadcrumb('auth.confirm_sign_in_completed');
      if (mounted.current) setSignedIn(true);
      // The same entry as a normal first sign-in: the root layout takes her to onboarding.
      completeSignIn(sessionUser);
      return;
    }
    busyRef.current = false;
    // A password that does not open this address is no use here: forget it.
    if (outcome === 'wrong-password') forgetRef.current();
    if (!mounted.current) return;
    setBusy(null);
    setNotice(outcome === 'not-confirmed' ? 'notYet' : outcome === 'wrong-password' ? 'alreadyHasAccount' : 'checkFailed');
  };

  // Back from the email app: try once. Away too long: forget the password.
  useEffect(() => {
    let wasBackgrounded = false;
    let backgroundedAt: number | null = null;
    let lastAutoTryAt: number | null = null;
    let forgetTimer: ReturnType<typeof setTimeout> | null = null;
    const forget = () => {
      if (!passwordRef.current) return;
      forgetRef.current();
      if (mounted.current) setNotice('passwordForgotten');
    };
    const subscription = AppState.addEventListener('change', (nextState) => {
      const nowMs = Date.now();
      if (nextState === 'background') {
        wasBackgrounded = true;
        if (backgroundedAt === null) backgroundedAt = nowMs;
        // Where timers keep running in the background, do not wait for her return.
        if (!forgetTimer) forgetTimer = setTimeout(forget, PASSWORD_MEMORY_BACKGROUND_LIMIT_MS + 1000);
        return;
      }
      if (nextState !== 'active') return;
      if (forgetTimer) clearTimeout(forgetTimer);
      forgetTimer = null;
      const returned = wasBackgrounded;
      const awaySince = backgroundedAt;
      wasBackgrounded = false;
      backgroundedAt = null;
      if (shouldForgetPassword(awaySince, nowMs)) {
        forget();
        return;
      }
      if (shouldAutoTryOnReturn({
        nextState,
        wasBackgrounded: returned,
        busy: busyRef.current,
        hasPassword: passwordRef.current.length > 0,
        lastAutoTryAtMs: lastAutoTryAt,
        nowMs,
      })) {
        lastAutoTryAt = nowMs;
        void trySignIn.current();
      }
    });
    return () => {
      subscription.remove();
      if (forgetTimer) clearTimeout(forgetTimer);
    };
  }, []);

  async function resend() {
    if (busyRef.current || resendSecondsLeft(lastSentAt, Date.now()) > 0) return;
    busyRef.current = true;
    setBusy('resending');
    let sent = false;
    let limited = false;
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: SIGN_UP_CONFIRM_REDIRECT_URL },
      });
      sent = !error;
      limited = error?.status === 429;
    } catch (resendError) {
      captureAppError(resendError);
    }
    busyRef.current = false;
    if (!mounted.current) return;
    setBusy(null);
    // The button rests after a send, and after the server says "too soon".
    if (sent || limited) {
      const sentAt = Date.now();
      setLastSentAt(sentAt);
      setNow(sentAt);
    }
    setNotice(sent ? 'resent' : 'resendFailed');
  }

  function goToSignIn() {
    forgetRef.current();
    // On web the query string lands in browser history; prefill natively only.
    router.replace({ pathname: '/(auth)/sign-in', params: Platform.OS !== 'web' ? { email } : {} });
  }

  const hasPassword = password.length > 0;
  const checking = busy === 'checking' || signedIn;
  const canResend = busy === null && !signedIn && secondsLeft <= 0;
  const canLeave = busy === null && !signedIn;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={[styles.card, { borderColor: colors.line }]}>
          <Text style={styles.icon} accessible={false} importantForAccessibility="no">📬</Text>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('confirmEmail.title')}</Text>
          <Text style={[styles.body, { color: colors.inkSoft }]}>{t('confirmEmail.sentTo')}</Text>
          <Text selectable style={[styles.email, { color: colors.ink }]}>{email}</Text>
          <Text style={[styles.body, { color: colors.inkSoft }]}>{t('confirmEmail.body')}</Text>

          {notice ? (
            // Calm on purpose: waiting for an email is not an error.
            <View
              accessibilityLiveRegion="polite"
              style={[styles.notice, { backgroundColor: colors.primaryLight, borderColor: colors.line }]}
            >
              <Text style={[styles.noticeText, { color: colors.ink }]}>{t(`confirmEmail.${notice}`)}</Text>
            </View>
          ) : null}

          {hasPassword || signedIn ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('confirmEmail.continueButton')}
              accessibilityState={{ disabled: busy !== null || signedIn, busy: checking }}
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              onPress={() => void trySignIn.current()}
              disabled={busy !== null || signedIn}
              activeOpacity={0.85}
            >
              {checking ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>{t('confirmEmail.continueButton')}</Text>}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ disabled: !canLeave }}
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              onPress={goToSignIn}
              disabled={!canLeave}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>{t('confirmEmail.signInButton')}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={secondsLeft > 0 ? t('confirmEmail.resendWait', { seconds: secondsLeft }) : t('confirmEmail.resendButton')}
            accessibilityState={{ disabled: !canResend, busy: busy === 'resending' }}
            style={[styles.secondaryBtn, { borderColor: canResend ? colors.primary : colors.line }]}
            onPress={() => void resend()}
            disabled={!canResend}
            activeOpacity={0.85}
          >
            {busy === 'resending' ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={[styles.secondaryBtnText, { color: canResend ? colors.primary : colors.inkSoft }]}>
                {secondsLeft > 0 ? t('confirmEmail.resendWait', { seconds: secondsLeft }) : t('confirmEmail.resendButton')}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ disabled: !canLeave }}
            style={styles.linkBtn}
            onPress={onUseDifferentEmail}
            disabled={!canLeave}
          >
            <Text style={[styles.linkText, { color: colors.primary }]}>{t('confirmEmail.differentEmail')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.emergency}>
          <EmergencyActions />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingBottom: 40 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    gap: 12,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 480,
  },
  icon: { fontSize: 44, textAlign: 'center' },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  body: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  email: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  notice: { borderWidth: 1, borderRadius: 12, padding: 12 },
  noticeText: { fontSize: 14, lineHeight: 20 },
  primaryBtn: { borderRadius: 99, paddingVertical: 14, minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: { borderRadius: 99, borderWidth: 1.5, paddingVertical: 12, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { fontSize: 15, fontWeight: '700' },
  linkBtn: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  linkText: { fontSize: 14, fontWeight: '700' },
  emergency: { marginTop: 28, alignSelf: 'center', width: '100%', maxWidth: 480 },
});
