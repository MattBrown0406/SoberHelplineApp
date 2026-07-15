import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { supabase } from '../../src/lib/supabase';
import { useAccount } from '../../src/contexts/AccountContext';

export default function InviteCodeScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('onboarding');
  const router = useRouter();
  const { refreshAccount } = useAccount();

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgName, setOrgName] = useState<string | null>(null);

  async function handleRedeem() {
    setError(null);
    setLoading(true);
    try {
      const { data, error: err } = await supabase.rpc('redeem_invite_code', {
        invite_code: code,
      });
      if (err || !data) {
        setError(t('invite.errorInvalid'));
        return;
      }
      await refreshAccount();
      setOrgName(data as string);
      setTimeout(() => router.push('/(onboarding)/consent'), 1200);
    } catch {
      setError(t('invite.errorInvalid'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.ink }]}>{t('invite.title')}</Text>
        <Text style={[styles.subtitle, { color: colors.inkSoft }]}>
          {t('invite.subtitle')}
        </Text>

        {orgName ? (
          <View style={[styles.successBox, { backgroundColor: colors.greenLight }]}>
            <Text style={[styles.successText, { color: colors.green }]}>
              ✓ {t('invite.success', { org: orgName })}
            </Text>
          </View>
        ) : (
          <>
            {error && (
              <View style={[styles.errorBox, { backgroundColor: colors.coralLight }]}>
                <Text style={[styles.errorText, { color: colors.coral }]}>{error}</Text>
              </View>
            )}
            <TextInput
              style={[styles.input, { borderColor: colors.line, color: colors.ink }]}
              placeholder={t('invite.placeholder')}
              placeholderTextColor={colors.inkSoft}
              value={code}
              onChangeText={(v) => setCode(v.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              onPress={handleRedeem}
              disabled={loading || code.trim().length < 4}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>{t('invite.submitButton')}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/(onboarding)/notifications')}
              style={styles.skipBtn}
            >
              <Text style={[styles.skipText, { color: colors.inkSoft }]}>
                {t('invite.skipButton')}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flex: 1, justifyContent: 'center', padding: 28, alignSelf: 'center', width: '100%', maxWidth: 480 },
  title: { fontSize: 23, fontWeight: '700', letterSpacing: -0.3 },
  subtitle: { fontSize: 14, lineHeight: 21, marginTop: 8, marginBottom: 24 },
  input: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderRadius: 14,
    padding: 16,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: 14,
  },
  primaryBtn: { borderRadius: 99, paddingVertical: 15, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  skipBtn: { alignItems: 'center', marginTop: 18 },
  skipText: { fontSize: 14, fontWeight: '600' },
  errorBox: { borderRadius: 10, padding: 12, marginBottom: 14 },
  errorText: { fontSize: 13, lineHeight: 18 },
  successBox: { borderRadius: 14, padding: 18, alignItems: 'center' },
  successText: { fontSize: 16, fontWeight: '700' },
});
