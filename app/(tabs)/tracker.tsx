import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';

export default function TrackerScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      <View style={styles.inner}>
        <Text style={[styles.title, { color: colors.ink }]}>{t('nav.tracker')}</Text>
        <Text style={[styles.sub, { color: colors.inkSoft }]}>{t('comingSoon')}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700' },
  sub: { fontSize: 14, marginTop: 6 },
});
