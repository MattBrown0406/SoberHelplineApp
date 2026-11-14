import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { confirmationEmailLastSentAt, resendSignUpConfirmation } from '../../lib/confirmationEmail';
import { resendSecondsLeft } from '../../lib/frontDoor';

/**
 * Under "Please confirm your email first" on the sign-in screen: the earlier
 * link may have expired (they last about an hour), and once the app has been
 * closed there was no other way to get a new one. Sends the same sign-up
 * confirmation email as the confirm step, to the address the sign-in was
 * refused for, and rests for a minute after each send.
 *
 * It is given the address only, nothing else she typed.
 */
export function ResendConfirmationNote({ email }: { email: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation('auth');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<'resent' | 'resendFailed' | null>(null);
  // An email sent a moment ago (sign-up, or this button before) still counts.
  const [lastSentAt, setLastSentAt] = useState<number | null>(() => confirmationEmailLastSentAt(email));
  const [now, setNow] = useState(() => Date.now());
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

  async function resend() {
    if (busyRef.current || resendSecondsLeft(lastSentAt, Date.now()) > 0) return;
    busyRef.current = true;
    setBusy(true);
    const outcome = await resendSignUpConfirmation(email);
    busyRef.current = false;
    if (!mounted.current) return;
    setBusy(false);
    // The button rests after a send, and after the server says "too soon".
    if (outcome !== 'failed') {
      const sentAt = Date.now();
      setLastSentAt(sentAt);
      setNow(sentAt);
    }
    setNotice(outcome === 'sent' ? 'resent' : 'resendFailed');
  }

  const canResend = !busy && secondsLeft <= 0;
  const label = secondsLeft > 0 ? t('confirmEmail.resendWait', { seconds: secondsLeft }) : t('signIn.resendConfirmation');

  return (
    // Calm on purpose: waiting for an email is not an error.
    <View style={[styles.note, { backgroundColor: colors.primaryLight, borderColor: colors.line }]}>
      <Text style={[styles.text, { color: colors.ink }]}>{t('signIn.unconfirmedExpired')}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !canResend, busy }}
        style={[styles.button, { borderColor: canResend ? colors.primary : colors.line }]}
        onPress={() => void resend()}
        disabled={!canResend}
        activeOpacity={0.85}
      >
        {busy ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Text style={[styles.buttonText, { color: canResend ? colors.primary : colors.inkSoft }]}>{label}</Text>
        )}
      </TouchableOpacity>
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={[styles.text, { color: colors.ink }]}>
          {t(`confirmEmail.${notice}`)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  note: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  text: { fontSize: 13.5, lineHeight: 19 },
  button: { borderRadius: 99, borderWidth: 1.5, paddingVertical: 11, paddingHorizontal: 14, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 14.5, fontWeight: '700', textAlign: 'center' },
});
