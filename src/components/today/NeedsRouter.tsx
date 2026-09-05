import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';

/**
 * Need-based front door. Families arrive with a question, not a feature in
 * mind — each row routes a common need straight to the screen that answers it.
 * Script needs land on the Scripts tab with the search pre-filled (`q` param).
 */
const NEEDS: { key: string; icon: string; route: string }[] = [
  { key: 'money', icon: '💵', route: '/(tabs)/scripts?q=money' },
  { key: 'using', icon: '👀', route: '/(tabs)/scripts?q=relapse' },
  { key: 'treatmentTalk', icon: '💬', route: '/(tabs)/scripts?q=treatment' },
  { key: 'findTreatment', icon: '🧭', route: '/finder' },
  { key: 'boundary', icon: '🏰', route: '/(tabs)/boundaries' },

];

export function NeedsRouter() {
  const { colors } = useTheme();
  const { t } = useTranslation('today');
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  return (
    <View style={[styles.card, { borderColor: colors.line }]}>
      <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
        {t('needs.eyebrow')}
      </Text>
      <TouchableOpacity
        accessibilityRole="button"
        onPress={() => router.push('/crisis-mode')}
        style={{ padding: 14, minHeight: 48, borderWidth: 1, borderRadius: 12, marginBottom: 10, borderColor: colors.coral, backgroundColor: colors.coralLight }}
      >
        <Text style={[styles.chipText, { color: colors.ink }]}>{t('needs.crisis')}</Text>
      </TouchableOpacity>
      <View style={styles.grid}>
        {NEEDS.slice(0, expanded ? NEEDS.length : 2).map(({ key, icon, route }) => (
          <TouchableOpacity
            key={key}
            accessibilityRole="button"
            style={[styles.chip, { borderColor: colors.line }]}
            activeOpacity={0.8}
            onPress={() => router.push(route as never)}
          >
            <Text style={styles.chipIcon}>{icon}</Text>
            <Text style={[styles.chipText, { color: colors.ink }]}>
              {t(`needs.${key}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <TouchableOpacity accessibilityRole="button" aria-expanded={expanded} accessibilityState={{ expanded }}
        onPress={() => setExpanded(value => !value)} style={{ paddingTop: 14, minHeight: 44 }}>
        <Text style={{ color: colors.primary, fontWeight: '600' }}>{t(expanded ? 'needs.fewer' : 'needs.more')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
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
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 10,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 11,
    backgroundColor: '#fafaf7',
    flexGrow: 1,
    flexBasis: '46%',
  },
  chipIcon: { fontSize: 15 },
  chipText: { fontSize: 12.5, fontWeight: '600', flex: 1, lineHeight: 16 },
});
