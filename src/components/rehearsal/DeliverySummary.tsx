import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import type { DeliveryReport } from '../../lib/practiceDelivery';

interface Props {
  report: DeliveryReport;
  /** Compact: history cards — stats on one line, tips only. */
  compact?: boolean;
}

/**
 * "Delivery" — how it sounded, not just what was said: pace, filler words,
 * "I" vs "you" sentences, questions, and turn length, with plain-language tips.
 */
export function DeliverySummary({ report, compact = false }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('rehearsalLive');

  const stats: { key: string; label: string; value: string }[] = [];
  if (report.wordsPerMinute !== null) {
    stats.push({ key: 'pace', label: t('debrief.delivery.pace'), value: t('debrief.delivery.paceValue', { wpm: report.wordsPerMinute }) });
  }
  if (report.fillerCount !== null) {
    stats.push({ key: 'fillers', label: t('debrief.delivery.fillers'), value: String(report.fillerCount) });
  }
  stats.push({ key: 'iYou', label: t('debrief.delivery.iYou'), value: `${report.iStatements} / ${report.youStatements}` });
  stats.push({ key: 'questions', label: t('debrief.delivery.questions'), value: String(report.questions) });
  if (!compact) {
    stats.push({
      key: 'avgTurn',
      label: t('debrief.delivery.avgTurn'),
      value: t('debrief.delivery.avgTurnValue', { words: report.avgTurnWords }),
    });
  }

  return (
    <View accessibilityRole="summary">
      {!compact && <Text style={[styles.section, { color: colors.secondary }]}>{t('debrief.delivery.title')}</Text>}
      <View style={styles.statRow}>
        {stats.map((stat) => (
          <View
            key={stat.key}
            style={[styles.stat, { backgroundColor: compact ? colors.ink : colors.primaryDark }]}
            accessible
            accessibilityLabel={`${stat.label}: ${stat.value}`}
          >
            <Text style={[styles.statValue, { color: colors.white }]} numberOfLines={1} adjustsFontSizeToFit>
              {stat.value}
            </Text>
            <Text style={[styles.statLabel, { color: colors.inkSoft }]} numberOfLines={1}>{stat.label}</Text>
          </View>
        ))}
      </View>
      {report.tips.map((tip) => (
        <Text key={tip.key} style={[compact ? styles.tipCompact : styles.tip, { color: colors.white }]}>
          •  {t(`debrief.delivery.tips.${tip.key}`, tip.vars)}
        </Text>
      ))}
      {!compact && report.voiceTurns === 0 && (
        <Text style={[styles.note, { color: colors.inkSoft }]}>{t('debrief.delivery.typedNote')}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 8,
  },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  stat: { borderRadius: 10, paddingVertical: 8, paddingHorizontal: 10, minWidth: 72, flexGrow: 1, alignItems: 'center' },
  statValue: { fontWeight: '700', fontSize: 14 },
  statLabel: { fontSize: 10, marginTop: 2 },
  tip: { fontSize: 14, lineHeight: 21, marginBottom: 6 },
  tipCompact: { fontSize: 12, lineHeight: 18, marginBottom: 4 },
  note: { fontSize: 12, lineHeight: 18, marginTop: 4, fontStyle: 'italic' },
});
