import React, { useState } from 'react';
import { GuidedStartPanel, GuidedButton } from '../../src/components/today/GuidedStartPanel';
import { guidedStartCopy } from '../../src/content/guidedStartCopy';
import { useAccount } from '../../src/contexts/AccountContext';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { AppLogo } from '../../src/components/ui/AppLogo';

export default function WelcomeScreen() {
  const { user } = useAccount();
  return <WelcomeContent key={user?.id ?? 'none'} />;
}
function WelcomeContent() {
  const [choosing, setChoosing] = useState(true);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('onboarding');
  const router = useRouter();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.primary }]}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.mark}><AppLogo size={64} /></View>
        <Text style={styles.title}>{t('welcome.title')}</Text>
        <Text style={styles.subtitle}>{t('welcome.subtitle')}</Text>

        {choosing ? <GuidedStartPanel onContinue={() => setChoosing(false)} /> : <>
        <View style={{ backgroundColor: colors.white, borderRadius: 12, marginBottom: 12 }}><GuidedButton label={guidedStartCopy(i18n.language).change} onPress={() => setChoosing(true)} /></View>
        <TouchableOpacity
          style={styles.choiceBtn}
          activeOpacity={0.85}
          onPress={() => router.push('/(onboarding)/invite-code')}
        >
          <Text style={[styles.choiceTitle, { color: colors.primary }]}>
            {t('welcome.providerButton')}
          </Text>
          <Text style={styles.choiceSub}>{t('welcome.providerSub')}</Text>
        </TouchableOpacity>

        {/* Direct path skips coach-sharing consent — per consent-architecture,
            direct users are asked at first coach interaction instead. */}
        <TouchableOpacity
          style={[styles.choiceBtn, styles.choiceBtnOutline]}
          activeOpacity={0.85}
          onPress={() => router.push('/(onboarding)/notifications')}
        >
          <Text style={[styles.choiceTitle, { color: '#fff' }]}>
            {t('welcome.directButton')}
          </Text>
          <Text style={[styles.choiceSub, { color: 'rgba(255,255,255,0.75)' }]}>
            {t('welcome.directSub')}
          </Text>
        </TouchableOpacity>
        </>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flexGrow: 1, justifyContent: 'center', padding: 28, alignSelf: 'center', width: '100%', maxWidth: 480 },
  mark: { marginBottom: 14 },
  title: { color: '#fff', fontSize: 27, fontWeight: '700', letterSpacing: -0.4 },
  subtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    marginBottom: 36,
  },
  choiceBtn: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 12,
  },
  choiceBtnOutline: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  choiceTitle: { fontSize: 16, fontWeight: '700' },
  choiceSub: { fontSize: 12.5, color: '#5c6b6a', marginTop: 4, lineHeight: 18 },
});
