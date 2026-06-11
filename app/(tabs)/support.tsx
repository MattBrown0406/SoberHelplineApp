import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useLanguage } from '../../src/hooks/useLanguage';

export default function SupportScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const { current, change, languages } = useLanguage();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Text style={[styles.heading, { color: colors.ink }]}>
            {t('nav.support')}
          </Text>
        </View>

        {/* Placeholder — Support tab content (crisis button, sessions, groups) ships next */}
        <View style={[styles.card, { borderColor: colors.line }]}>
          <Text style={[styles.sub, { color: colors.inkSoft }]}>
            {t('comingSoon')}
          </Text>
        </View>

        {/* Language selector */}
        <View style={[styles.card, { borderColor: colors.line }]}>
          <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
            {t('language.eyebrow')}
          </Text>
          <View style={styles.pillRow}>
            {languages.map((lang) => {
              const active = current === lang.code;
              return (
                <TouchableOpacity
                  key={lang.code}
                  style={[
                    styles.pill,
                    {
                      borderColor: active ? colors.primary : colors.line,
                      backgroundColor: active ? colors.primaryLight : '#fff',
                    },
                  ]}
                  onPress={() => change(lang.code)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.pillText,
                      { color: active ? colors.primary : colors.inkSoft },
                    ]}
                  >
                    {lang.nativeLabel}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 32 },
  headerRow: {
    marginBottom: 16,
    marginTop: 8,
  },
  heading: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    shadowColor: '#22302f',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 8,
  },
  pill: {
    borderWidth: 1.5,
    borderRadius: 99,
    paddingVertical: 8,
    paddingHorizontal: 18,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  sub: {
    fontSize: 14,
    fontStyle: 'italic',
  },
});
