import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { registerForPushNotifications } from '../../src/hooks/usePushNotifications';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useAccount } from '../../src/contexts/AccountContext';
import { supabase } from '../../src/lib/supabase';
import { appAlert } from '../../src/lib/appAlert';
import { markOnboarded } from '../../src/onboarding/state';

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('onboarding');
  const { user } = useAccount();
  const router = useRouter();
  const [done, setDone] = useState(false);

  // First-win: reserve a spot at Monday's free call (The Family Squares) in
  // one tap. The button and its note name that call, so only its session is
  // offered — never whichever group session happens to come first.
  const [nextGroupId, setNextGroupId] = useState<string | null>(null);
  const [rsvped, setRsvped] = useState(false);
  const [reserving, setReserving] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.resolve(supabase.rpc('family_squares_session_id'))
      .then(({ data, error }) => {
        if (active && !error && typeof data === 'string' && data) setNextGroupId(data);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function reserveSpot() {
    if (!user?.id || !nextGroupId || rsvped) return;
    setReserving(true);
    const { error } = await supabase
      .from('session_rsvps')
      .upsert({ session_id: nextGroupId, account_id: user.id, status: 'going' });
    setReserving(false);
    if (!error) setRsvped(true);
  }

  async function finish(askPermission: boolean) {
    if (askPermission && Platform.OS !== 'web' && user?.id) {
      try {
        if (!await registerForPushNotifications(user.id, true, true)) appAlert(t('notifications.unavailable'));
      } catch { appAlert(t('notifications.unavailable')); }
    }
    if (!user?.id) return;
    await markOnboarded(user.id);
    setDone(true);
  }

  if (done) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.primary }]}>
        <View style={styles.body}>
          <Text style={styles.icon}>🏰</Text>
          <Text style={[styles.title, { color: '#fff' }]}>{t('done.title')}</Text>
          <Text style={[styles.bodyText, { color: 'rgba(255,255,255,0.8)' }]}>
            {t('done.body')}
          </Text>

          {nextGroupId && (
            <TouchableOpacity
              style={[
                styles.rsvpBtn,
                { borderColor: '#fff', backgroundColor: rsvped ? '#fff' : 'transparent' },
              ]}
              onPress={() => void reserveSpot()}
              disabled={reserving || rsvped}
              activeOpacity={0.85}
            >
              <Text style={[styles.rsvpBtnText, { color: rsvped ? colors.primary : '#fff' }]}>
                {rsvped ? t('done.rsvpDone') : t('done.rsvpButton')}
              </Text>
            </TouchableOpacity>
          )}
          {nextGroupId && (
            <Text style={[styles.rsvpNote, { color: 'rgba(255,255,255,0.8)' }]}>
              {t('common:familySquares.rsvpNote')}
            </Text>
          )}

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: '#fff' }]}
            onPress={() => router.replace('/(tabs)')}
            activeOpacity={0.85}
          >
            <Text style={[styles.primaryBtnText, { color: colors.primary }]}>
              {t('done.button')}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      <View style={styles.body}>
        <Text style={styles.icon}>🔔</Text>
        <Text style={[styles.title, { color: colors.ink }]}>
          {t('notifications.title')}
        </Text>
        <Text style={[styles.bodyText, { color: colors.inkSoft }]}>
          {t('notifications.body')}
        </Text>
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
          onPress={() => finish(true)}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>{t('notifications.acceptButton')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipBtn} onPress={() => finish(false)}>
          <Text style={[styles.skipText, { color: colors.inkSoft }]}>
            {t('notifications.declineButton')}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flex: 1, justifyContent: 'center', padding: 28, alignSelf: 'center', width: '100%', maxWidth: 480 },
  icon: { fontSize: 40, marginBottom: 12 },
  title: { fontSize: 23, fontWeight: '700', letterSpacing: -0.3 },
  bodyText: { fontSize: 14.5, lineHeight: 22, marginTop: 10, marginBottom: 30 },
  primaryBtn: { borderRadius: 99, paddingVertical: 15, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  rsvpBtn: { borderRadius: 99, borderWidth: 1.5, paddingVertical: 14, alignItems: 'center', marginBottom: 12 },
  rsvpBtnText: { fontSize: 15, fontWeight: '700' },
  rsvpNote: { fontSize: 12.5, lineHeight: 18, textAlign: 'center', marginBottom: 16 },
  skipBtn: { alignItems: 'center', marginTop: 16 },
  skipText: { fontSize: 14, fontWeight: '600' },
});
