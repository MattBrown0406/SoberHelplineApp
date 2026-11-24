import React, { useState } from 'react';
import { guidedStartCopy } from '../../src/content/guidedStartCopy';
import { useAccount } from '../../src/contexts/AccountContext';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { AppLogo } from '../../src/components/ui/AppLogo';
import { EmergencyActions } from '../../src/components/safety/EmergencyActions';
import { NavyScreenStatusBar } from '../../src/components/auth/NavyScreenStatusBar';

export default function WelcomeScreen() {
  const { user } = useAccount();
  return <WelcomeContent key={user?.id ?? 'none'} accountId={user?.id ?? null} />;
}
// 4.4: the first screen goes straight to the two ways in. The old "What brings
// you here today?" question is gone (nothing used its answer once Today's path
// came from the loved one's phase); its urgent answer stays, as a quiet link
// that shows emergency help right here and never waits for anything.
function WelcomeContent({ accountId: _accountId }: { accountId: string | null }) {
  const [urgent, setUrgent] = useState(false);
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('onboarding');
  const router = useRouter();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.primary }]}>
      <NavyScreenStatusBar />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.mark}><AppLogo size={64} /></View>
        <Text style={styles.title}>{t('welcome.title')}</Text>
        <Text style={styles.subtitle}>{t('welcome.subtitle')}</Text>

        <TouchableOpacity
          accessibilityRole="button"
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
            direct users are asked at first coach interaction instead — but
            still gets the loved-one intake (it has its own Skip). */}
        <TouchableOpacity
          accessibilityRole="button"
          style={[styles.choiceBtn, styles.choiceBtnOutline]}
          activeOpacity={0.85}
          onPress={() => router.push('/(onboarding)/loved-one')}
        >
          <Text style={[styles.choiceTitle, { color: '#fff' }]}>
            {t('welcome.directButton')}
          </Text>
          <Text style={[styles.choiceSub, { color: 'rgba(255,255,255,0.88)' }]}>
            {t('welcome.directSub')}
          </Text>
        </TouchableOpacity>

        {/* Urgent help: a quiet link, not a third choice, and nothing to wait for. */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ expanded: urgent }}
          style={styles.changeLink}
          onPress={() => setUrgent((open) => !open)}
        >
          <Text style={styles.changeLinkText}>{guidedStartCopy(i18n.language).situations.urgent}</Text>
        </TouchableOpacity>
        {urgent && (
          <View style={[styles.urgent, { backgroundColor: colors.white }]}>
            <Text accessibilityRole="alert" style={[styles.urgentText, { color: colors.ink }]}>
              {guidedStartCopy(i18n.language).disclaimer}
            </Text>
            <EmergencyActions prominent />
          </View>
        )}
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
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  // A second choice, plainly available: a solid white outline and white words
  // (a faint fill and border read as switched off).
  choiceBtnOutline: {
    backgroundColor: 'transparent',
  },
  choiceTitle: { fontSize: 16, fontWeight: '700' },
  choiceSub: { fontSize: 12.5, color: '#5c6b6a', marginTop: 4, lineHeight: 18 },
  changeLink: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, marginTop: 4 },
  changeLinkText: { color: '#fff', fontSize: 14, fontWeight: '600', textAlign: 'center', textDecorationLine: 'underline' },
  urgent: { marginTop: 8, borderRadius: 16, padding: 16 },
  urgentText: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
});
