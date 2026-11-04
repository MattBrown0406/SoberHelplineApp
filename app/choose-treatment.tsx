import { useToolOpened } from '../src/hooks/useToolOpened';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScreenContainer } from '../src/components/ui/ScreenContainer';
import { useAccount } from '../src/contexts/AccountContext';
import { useTheme } from '../src/contexts/ThemeContext';

type Question = { q: string; why: string };

/**
 * How to choose a treatment program: the questions to ask every program and
 * the red flags (patient brokering among them). Reached from the finder,
 * Tools, and Crisis Mode's "Arrested" plan, whose step 2 is "find a program
 * that meets their needs, not just one that takes their insurance".
 */
export default function ChooseTreatmentScreen() {
  useToolOpened('choose_treatment');
  const router = useRouter();
  const { t } = useTranslation('chooseTreatment');
  const { colors } = useTheme();
  const { isAttached } = useAccount();
  const ask = t('ask', { returnObjects: true }) as Question[];
  const flags = t('flags', { returnObjects: true }) as string[];
  const before = t('before', { returnObjects: true }) as string[];

  return (
    <ScreenContainer scroll contentContainerStyle={styles.screen}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('back')} onPress={() => router.back()}>
        <Text style={[styles.back, { color: colors.primary }]}>{t('back')}</Text>
      </TouchableOpacity>
      <Text style={[styles.kicker, { color: colors.coral }]}>{t('kicker')}</Text>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>{t('title')}</Text>
      <Text style={[styles.intro, { color: colors.inkSoft }]}>{t('intro')}</Text>

      <View style={[styles.section, { borderColor: colors.line, backgroundColor: colors.white }]}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.ink }]}>{t('askTitle')}</Text>
        {ask.map((item, index) => (
          <View key={item.q} style={styles.row}>
            <Text style={[styles.number, { color: colors.primary }]}>{index + 1}</Text>
            <View style={styles.flex}>
              <Text style={[styles.question, { color: colors.ink }]}>{item.q}</Text>
              <Text style={[styles.why, { color: colors.inkSoft }]}>{item.why}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={[styles.section, { borderColor: colors.coral, backgroundColor: colors.coralLight }]}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.coral }]}>{t('flagsTitle')}</Text>
        {flags.map((flag) => (
          <View key={flag} style={styles.row}>
            <Text style={[styles.number, { color: colors.coral }]}>!</Text>
            <Text style={[styles.flex, styles.item, { color: colors.ink }]}>{flag}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.section, { borderColor: colors.line, backgroundColor: colors.white }]}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.ink }]}>{t('beforeTitle')}</Text>
        {before.map((step) => (
          <View key={step} style={styles.row}>
            <Text style={[styles.number, { color: colors.green }]}>✓</Text>
            <Text style={[styles.flex, styles.item, { color: colors.ink }]}>{step}</Text>
          </View>
        ))}
      </View>

      <ActionLink label={t('finder')} onPress={() => router.push('/finder' as never)} />
      <ActionLink
        label={t('saidYes')}
        onPress={() => router.push({ pathname: '/treatment-action-plan', params: { focus: 'yes', source: 'choose_treatment' } } as never)}
      />
      {!isAttached && <ActionLink label={t('bookSession')} onPress={() => router.push('/book-coaching' as never)} />}
      <Text style={[styles.note, { color: colors.inkSoft }]}>{t('note')}</Text>
    </ScreenContainer>
  );
}

function ActionLink({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.action, { borderColor: colors.primary, backgroundColor: colors.white }]}
    >
      <Text style={[styles.actionText, { color: colors.primary }]}>{label} ›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, paddingBottom: 48 },
  back: { fontSize: 15, fontWeight: '700', marginBottom: 20 },
  kicker: { fontSize: 11, fontWeight: '900', letterSpacing: 1.3, marginBottom: 7 },
  title: { fontSize: 29, lineHeight: 34, fontWeight: '900', marginBottom: 10 },
  intro: { fontSize: 16, lineHeight: 23, marginBottom: 18 },
  section: { borderWidth: 1, borderRadius: 14, padding: 18, marginBottom: 18 },
  sectionTitle: { fontSize: 19, fontWeight: '900', marginBottom: 12 },
  row: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  number: { fontSize: 15, fontWeight: '900', width: 18 },
  flex: { flex: 1 },
  question: { fontSize: 15, lineHeight: 21, fontWeight: '700' },
  why: { fontSize: 13.5, lineHeight: 19, marginTop: 3 },
  item: { fontSize: 14.5, lineHeight: 21 },
  action: { borderWidth: 1.5, borderRadius: 12, minHeight: 48, justifyContent: 'center', paddingHorizontal: 16, marginBottom: 10 },
  actionText: { fontSize: 15, fontWeight: '800' },
  note: { fontSize: 12.5, lineHeight: 18, fontStyle: 'italic', marginTop: 8, textAlign: 'center' },
});
