import { useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View, StyleSheet, Linking } from 'react-native';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useAccount } from '../../src/contexts/AccountContext';
import { FreeTierPaywall } from '../../src/components/ui/FreeTierPaywall';
import { useWebSSO } from '../../src/hooks/useWebSSO';
import { isAdminEmail } from '../../src/lib/admin';

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
  const { user, accountState } = useAccount();
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

  if (accountState === 'direct-free' && !isAdminEmail(user?.email)) return <FreeTierPaywall />;

  return (
    <ScreenContainer scroll contentContainerStyle={styles.inner}>
      <Text style={[styles.header, { color: colors.ink }]}>{t('header')}</Text>

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
