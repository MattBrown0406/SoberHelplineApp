import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { benefitLines, type BenefitPlan } from '../../lib/membershipBenefits';

/**
 * A plan's benefits, one short line each, read from the single list in
 * plans.json (membershipBenefits.ts). `limit` shows only the first few.
 */
export function BenefitList({ plan, limit, color }: { plan: BenefitPlan; limit?: number; color?: string }) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('plans');
  const lines = benefitLines(plan, t as never, i18n.language);
  return (
    <View>
      {(limit ? lines.slice(0, limit) : lines).map((line) => (
        <View key={line} style={styles.row}>
          <Text accessible={false} style={[styles.mark, { color: color ?? colors.primary }]}>•</Text>
          <Text style={[styles.line, { color: colors.ink }]}>{line}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 6 },
  mark: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  line: { flex: 1, fontSize: 14, lineHeight: 20 },
});
