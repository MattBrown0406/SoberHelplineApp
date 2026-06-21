import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useAccount } from '../../src/contexts/AccountContext';
import { supabase } from '../../src/lib/supabase';

const COACH_SHARING_CONSENT_KEY = '2'; // per docs/legal/consent-architecture.md

export default function ConsentScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('onboarding');
  const { user } = useAccount();
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function record(granted: boolean) {
    setSaving(true);
    if (user) {
      await supabase.from('consents').upsert(
        {
          account_id: user.id,
          consent_key: COACH_SHARING_CONSENT_KEY,
          version: '1.0',
          granted_at: granted ? new Date().toISOString() : null,
          revoked_at: granted ? null : new Date().toISOString(),
        },
        { onConflict: 'account_id, consent_key' },
      );
    }
    setSaving(false);
    router.push('/(onboarding)/loved-one');
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      <View style={styles.body}>
        <Text style={styles.icon}>🤝</Text>
        <Text style={[styles.title, { color: colors.ink }]}>{t('consent.title')}</Text>
        <Text style={[styles.bodyText, { color: colors.inkSoft }]}>
          {t('consent.body')}
        </Text>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
          onPress={() => record(true)}
          disabled={saving}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>{t('consent.acceptButton')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={() => record(false)}
          disabled={saving}
        >
          <Text style={[styles.skipText, { color: colors.inkSoft }]}>
            {t('consent.declineButton')}
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
  skipBtn: { alignItems: 'center', marginTop: 16 },
  skipText: { fontSize: 14, fontWeight: '600' },
});
