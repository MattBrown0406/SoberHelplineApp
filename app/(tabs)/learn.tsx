import { useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View, StyleSheet, Linking } from 'react-native';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useAccount } from '../../src/contexts/AccountContext';
import { useWebSSO } from '../../src/hooks/useWebSSO';


type ContentSection = { key: string; path: string; sso: boolean };
type FaqItem = { q: string; a: string };

const SECTIONS: ContentSection[] = [
  { key: 'education', path: '/family-education', sso: true },
  { key: 'recordings', path: '/zoom-recordings', sso: true },
];

function FaqRow({ item, colors }: { item: FaqItem; colors: ReturnType<typeof useTheme>['colors'] }) {
  const [open, setOpen] = useState(false);
  return (
    <TouchableOpacity
      style={[styles.faqRow, { borderBottomColor: colors.line }]}
      activeOpacity={0.75}
      onPress={() => setOpen((v) => !v)}
    >
      <View style={styles.faqHead}>
        <Text style={[styles.faqQ, { color: colors.ink }]}>{item.q}</Text>
        <Text style={[styles.faqToggle, { color: colors.inkSoft }]}>{open ? '−' : '+'}</Text>
      </View>
      {open && <Text style={[styles.faqA, { color: colors.inkSoft }]}>{item.a}</Text>}
    </TouchableOpacity>
  );
}

export default function LearnScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('learn');
  const { user, entitlements, accountState } = useAccount();
  const router = useRouter();
  const { openWithSSO } = useWebSSO();
  const [faqQuery, setFaqQuery] = useState('');

  const faqItems = useMemo(
    () => t('faq.items', { returnObjects: true }) as FaqItem[],
    [t],
  );
  const filteredFaq = useMemo(() => {
    const q = faqQuery.trim().toLowerCase();
    if (!q) return faqItems;
    return faqItems.filter(
      (item) => item.q.toLowerCase().includes(q) || item.a.toLowerCase().includes(q),
    );
  }, [faqItems, faqQuery]);

  return (
    <ScreenContainer scroll contentContainerStyle={styles.inner}>
      <Text style={[styles.header, { color: colors.ink }]}>{t('header')}</Text>

      <Text style={[styles.sectionEyebrow, { color: colors.inkSoft }]}>{t('tools.eyebrow')}</Text>

      <View style={[styles.featuredTool, { backgroundColor: colors.primaryDark }]}>
        <View style={styles.toolTopRow}>
          <Text style={styles.toolIcon}>✅</Text>
          <Text style={[styles.toolBadge, { backgroundColor: colors.coral }]}>{t('tools.actionBadge')}</Text>
        </View>
        <Text style={styles.featuredTitle}>{t('tools.actionTitle')}</Text>
        <Text style={styles.featuredBody}>{t('tools.actionBody')}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('tools.actionButton')}
          style={[styles.cardButton, { backgroundColor: colors.secondary }]}
          onPress={() => router.push('/treatment-action-plan' as never)}
          activeOpacity={0.85}
        >
          <Text style={styles.cardButtonText}>{t('tools.actionButton')}</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.coral }]}>
        <View style={styles.toolTopRow}>
          <Text style={styles.toolIcon}>🏠</Text>
          <Text style={[styles.toolBadge, { backgroundColor: colors.coral }]}>{t('tools.homecomingBadge')}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('tools.homecomingTitle')}</Text>
        <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('tools.homecomingBody')}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('tools.homecomingButton')}
          style={[styles.cardButton, { backgroundColor: colors.coral }]}
          onPress={() => router.push('/homecoming-week' as never)}
          activeOpacity={0.85}
        >
          <Text style={styles.cardButtonText}>{t('tools.homecomingButton')}</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.primary }]}>
        <View style={styles.toolTopRow}>
          <Text style={styles.toolIcon}>🕰️</Text>
          <Text style={[styles.toolBadge, { backgroundColor: colors.primary }]}>{t('tools.visitationBadge')}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('tools.visitationTitle')}</Text>
        <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('tools.visitationBody')}</Text>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('tools.visitationButton')}
          style={[styles.cardButton, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/family-visitation-plan' as never)}
          activeOpacity={0.85}
        >
          <Text style={styles.cardButtonText}>{t('tools.visitationButton')}</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
        <View style={styles.toolTopRow}>
          <Text style={styles.toolIcon}>💵</Text>
          <Text style={[styles.toolBadge, { backgroundColor: colors.secondary }]}>{t('tools.costBadge')}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('tools.costTitle')}</Text>
        <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('tools.costBody')}</Text>
        <TouchableOpacity
          style={[styles.cardButton, { backgroundColor: colors.secondary }]}
          onPress={() => router.push('/enabling-costs' as never)}
          activeOpacity={0.85}
        >
          <Text style={styles.cardButtonText}>{t('tools.costButton')}</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.green }]}>
        <View style={styles.toolTopRow}>
          <Text style={styles.toolIcon}>🛟</Text>
          <Text style={[styles.toolBadge, { color: colors.green, backgroundColor: colors.greenLight }]}>{t('tools.safetyBadge')}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('tools.safetyTitle')}</Text>
        <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('tools.safetyBody')}</Text>
        <TouchableOpacity
          style={[styles.cardButton, { backgroundColor: colors.green }]}
          onPress={() => router.push('/safety-wallet' as never)}
          activeOpacity={0.85}
        >
          <Text style={styles.cardButtonText}>{t('tools.safetyButton')}</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.sectionEyebrow, { color: colors.inkSoft }]}>{t('tools.learningEyebrow')}</Text>

      {entitlements.canAccessLearningContent ? (
        <>
          {SECTIONS.map(({ key, path, sso }) => (
            <View key={key} style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
              <Text style={[styles.cardTitle, { color: colors.ink }]}>{t(`${key}.title`)}</Text>
              <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t(`${key}.body`)}</Text>
              <TouchableOpacity
                style={[styles.cardButton, { backgroundColor: colors.primary }]}
                onPress={() => sso ? void openWithSSO(user?.id ?? null, path) : void Linking.openURL(path)}
                activeOpacity={0.85}
              >
                <Text style={styles.cardButtonText}>{t(`${key}.button`)}</Text>
              </TouchableOpacity>
            </View>
          ))}

          {/* In-app answers to the questions every family asks — no web round-trip. */}
          <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('faq.eyebrow')}</Text>
            <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('faq.sub')}</Text>
            <View style={[styles.faqSearch, { borderColor: colors.line }]}>
              <Text style={styles.faqSearchIcon}>🔍</Text>
              <TextInput
                style={[styles.faqSearchInput, { color: colors.ink }]}
                value={faqQuery}
                onChangeText={setFaqQuery}
                placeholder={t('faq.eyebrow')}
                placeholderTextColor={colors.inkSoft}
                autoCorrect={false}
              />
            </View>
            {filteredFaq.map((item) => (
              <FaqRow key={item.q} item={item} colors={colors} />
            ))}
          </View>
        </>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  inner: { padding: 20, paddingBottom: 40 },
  header: { fontSize: 24, fontWeight: '700', marginBottom: 20 },
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  featuredTool: {
    borderRadius: 18,
    padding: 20,
    marginBottom: 16,
  },
  toolTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  toolIcon: { fontSize: 25 },
  toolBadge: {
    color: '#fff',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 10.5,
    fontWeight: '800',
  },
  featuredTitle: { color: '#fff', fontSize: 20, lineHeight: 25, fontWeight: '800', marginBottom: 7 },
  featuredBody: { color: '#d9e3ed', fontSize: 14, lineHeight: 20, marginBottom: 17 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
    marginBottom: 16,
  },
  cardTitle: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  cardBody: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  cardButton: { alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  cardButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  faqSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 6,
  },
  faqSearchIcon: { fontSize: 13 },
  faqSearchInput: { flex: 1, fontSize: 13.5, padding: 0 },
  faqRow: { paddingVertical: 13, borderBottomWidth: 1 },
  faqHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  faqQ: { flex: 1, fontSize: 14.5, fontWeight: '600', lineHeight: 20 },
  faqToggle: { fontSize: 18, fontWeight: '600' },
  faqA: { fontSize: 13.5, lineHeight: 20, marginTop: 9 },
});
