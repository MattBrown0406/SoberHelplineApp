import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';

/** "Step 3 of 10" with a thin progress bar. */
export function StepProgress({ step, total }: { step: number; total: number }) {
  const { colors } = useTheme();
  const { t } = useTranslation('invitation');
  const label = t('setup.progress', { step, total });
  const percent = total > 0 ? Math.round((step / total) * 100) : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: total, now: step }}
      style={styles.wrap}
    >
      <Text style={[styles.label, { color: colors.inkSoft }]}>{label}</Text>
      <View style={[styles.track, { backgroundColor: colors.line }]}>
        <View style={[styles.fill, { width: `${percent}%`, backgroundColor: colors.primary }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '800', marginBottom: 6 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
});
