import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from './ScreenContainer';
import { walletMembershipCopy } from '../../content/walletMembershipCopy';
import { useTheme } from '../../contexts/ThemeContext';

export function FreeTierPaywall({ inline = false, feature }: { inline?: boolean; feature?: 'aiRehearsal' }) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('support');
  const copy = walletMembershipCopy(i18n.language);
  const router = useRouter();

  const card = (
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
      <Text style={styles.lock}>🔒</Text>
      <Text style={[styles.heading, { color: colors.ink }]}>
        {t(feature === 'aiRehearsal' ? 'practiceGate.heading' : 'paywall.heading')}
      </Text>
      <Text style={[styles.body, { color: colors.inkSoft }]}>
        {t(feature === 'aiRehearsal' ? 'practiceGate.body' : 'paywall.body')}
      </Text>
      {feature === 'aiRehearsal' ? (
        <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/free-practice')} style={styles.freeAction}>
          <Text style={{ color: colors.primary, textAlign: 'center' }}>{t('practiceGate.freeAction')}</Text>
        </TouchableOpacity>
      ) : <Text style={[styles.body, { color: colors.inkSoft }]}>{copy.free}</Text>}
      <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/crisis-mode')} style={{ padding: 12 }}>
        <Text style={{ color: colors.primary }}>{t('crisis.copilotButton')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: colors.primary }]}
        onPress={() => router.push('/(tabs)/support')}
        activeOpacity={0.85}
      >
        <Text style={styles.btnText}>{t('paywall.viewPlans')}</Text>
      </TouchableOpacity>
    </View>
  );

  // Inline: sit within an existing scroll (e.g. below the Today situation card).
  if (inline) return card;

  return (
    <ScreenContainer backgroundColor={colors.cream} contentContainerStyle={styles.container}>
      {card}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    borderWidth: 1,
    padding: 28,
    alignItems: 'center',
    gap: 12,
  },
  freeAction: { minHeight: 44, justifyContent: 'center', padding: 12 },
  lock: { fontSize: 40, marginBottom: 4 },
  heading: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  body: { fontSize: 14, lineHeight: 21, textAlign: 'center' },
  btn: {
    marginTop: 8,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    alignItems: 'center',
    width: '100%',
  },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
