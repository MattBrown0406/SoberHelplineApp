import { useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View, StyleSheet, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useAccount } from '../../src/contexts/AccountContext';
import { useWebSSO } from '../../src/hooks/useWebSSO';

type FaqItem = { q: string; a: string };
type ResourceItem = { title: string; body: string };

function ExpandRow({
  title,
  body,
  colors,
}: {
  title: string;
  body: string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  const [open, setOpen] = useState(false);
  return (
    <TouchableOpacity
      style={[styles.faqRow, { borderBottomColor: colors.line }]}
      activeOpacity={0.75}
      onPress={() => setOpen((v) => !v)}
    >
      <View style={styles.faqHead}>
        <Text style={[styles.faqQ, { color: colors.ink }]}>{title}</Text>
        <Text style={[styles.faqToggle, { color: colors.inkSoft }]}>{open ? '−' : '+'}</Text>
      </View>
      {open && <Text style={[styles.faqA, { color: colors.inkSoft }]}>{body}</Text>}
    </TouchableOpacity>
  );
}

export default function LearnScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('learn');
  const { user, entitlements, accountState } = useAccount();
  const { openWithSSO } = useWebSSO();
  const router = useRouter();
  const [faqQuery, setFaqQuery] = useState('');
  const learningOpen = entitlements.canAccessLearningContent;
  const recordingsOpen = accountState !== 'direct-free';

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

  const educationSections = useMemo(() => {
    const value = t('education.sections', { returnObjects: true });
    return Array.isArray(value) ? (value as ResourceItem[]) : [];
  }, [t]);
  const levels = useMemo(() => {
    const value = t('resources.levels.items', { returnObjects: true });
    return Array.isArray(value) ? (value as ResourceItem[]) : [];
  }, [t]);

  if (!learningOpen) return null;

  return (
    <ScreenContainer scroll contentContainerStyle={styles.inner}>
      <Text style={[styles.header, { color: colors.ink }]}>{t('header')}</Text>

      <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('education.title')}</Text>
        <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('education.body')}</Text>
        {educationSections.map((section) => (
          <ExpandRow key={section.title} title={section.title} body={section.body} colors={colors} />
        ))}
      </View>

      <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
        <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('resources.eyebrow')}</Text>
        <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('resources.sub')}</Text>

        <Text style={[styles.sectionLabel, { color: colors.inkSoft }]}>{t('resources.levels.title')}</Text>
        {levels.map((item) => (
          <ExpandRow key={item.title} title={item.title} body={item.body} colors={colors} />
        ))}

        <ExpandRow
          title={t('resources.fellowships.title')}
          body={t('resources.fellowships.body')}
          colors={colors}
        />
        <ExpandRow
          title={t('resources.naloxone.title')}
          body={t('resources.naloxone.body')}
          colors={colors}
        />

        <TouchableOpacity
          style={[styles.linkRow, { borderColor: colors.line }]}
          onPress={() => void Linking.openURL('tel:988')}
        >
          <Text style={[styles.linkTitle, { color: colors.ink }]}>{t('resources.lifeline.title')}</Text>
          <Text style={[styles.linkAction, { color: colors.primary }]}>{t('resources.lifeline.action')}</Text>
        </TouchableOpacity>
        <Text style={[styles.cardBody, { color: colors.inkSoft, marginBottom: 12 }]}>
          {t('resources.lifeline.body')}
        </Text>

        <TouchableOpacity
          style={[styles.cardButton, { backgroundColor: colors.primary }]}
          onPress={() => router.push('/finder')}
          activeOpacity={0.85}
        >
          <Text style={styles.cardButtonText}>{t('resources.finder.button')}</Text>
        </TouchableOpacity>
        <Text style={[styles.finderNote, { color: colors.inkSoft }]}>{t('resources.finder.note')}</Text>
      </View>

      {recordingsOpen ? (
        <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
          <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('recordings.title')}</Text>
          <Text style={[styles.cardBody, { color: colors.inkSoft }]}>{t('recordings.body')}</Text>
          <TouchableOpacity
            style={[styles.cardButton, { backgroundColor: colors.primary }]}
            onPress={() => void openWithSSO(user?.id ?? null, '/zoom-recordings')}
            activeOpacity={0.85}
          >
            <Text style={styles.cardButtonText}>{t('recordings.button')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

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
          <ExpandRow key={item.q} title={item.q} body={item.a} colors={colors} />
        ))}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  inner: { padding: 20, paddingBottom: 40 },
  header: { fontSize: 24, fontWeight: '700', marginBottom: 20 },
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
  sectionLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, marginBottom: 4, marginTop: 4 },
  finderNote: { fontSize: 12.5, lineHeight: 18, marginTop: 10 },
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    paddingVertical: 12,
    gap: 10,
  },
  linkTitle: { flex: 1, fontSize: 14.5, fontWeight: '600' },
  linkAction: { fontSize: 14, fontWeight: '700' },
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
