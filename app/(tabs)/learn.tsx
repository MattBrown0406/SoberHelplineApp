import { Text, StyleSheet } from 'react-native';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';

export default function LearnScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  return (
    <ScreenContainer scroll={false} contentContainerStyle={styles.inner}>
      <Text style={[styles.title, { color: colors.ink }]}>{t('nav.learn')}</Text>
      <Text style={[styles.sub, { color: colors.inkSoft }]}>{t('comingSoon')}</Text>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  inner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700' },
  sub: { fontSize: 14, marginTop: 6 },
});
