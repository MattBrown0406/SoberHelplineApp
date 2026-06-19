import { Text, TouchableOpacity, View, StyleSheet, Linking } from 'react-native';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useAccount } from '../../src/contexts/AccountContext';
import { FreeTierPaywall } from '../../src/components/ui/FreeTierPaywall';
import { useWebSSO } from '../../src/hooks/useWebSSO';

type ContentSection = { key: string; path: string; sso: boolean };

const SECTIONS: ContentSection[] = [
  { key: 'education', path: '/family-education', sso: true },
  { key: 'recordings', path: '/zoom-recordings', sso: true },
  { key: 'resources', path: 'https://soberhelpline.com/recovery-resources', sso: false },
];

export default function LearnScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('learn');
  const { user, accountState } = useAccount();
  const { openWithSSO } = useWebSSO();

  if (accountState === 'direct-free') return <FreeTierPaywall />;

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
});
