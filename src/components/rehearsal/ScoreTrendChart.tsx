import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { SCORE_KEYS, type ScoreTrend } from '../../lib/practiceTrends';

const BAR_MAX = 34;

/**
 * The four coaching scores across recent full practices — one small bar row
 * per score, oldest to newest, with the change since the first. Plain Views:
 * no chart dependency.
 */
export function ScoreTrendChart({ trend }: { trend: ScoreTrend }) {
  const { colors } = useTheme();
  const { t } = useTranslation('rehearsalLive');
  if (trend.points.length < 2) return null;
  const latest = trend.points[trend.points.length - 1].scores;

  return (
    <View style={[styles.card, { backgroundColor: colors.primaryDark }]}>
      <Text style={[styles.title, { color: colors.white }]}>{t('history.trendTitle')}</Text>
      <Text style={[styles.body, { color: colors.inkSoft }]}>
        {t('history.trendBody', { count: trend.points.length })}
      </Text>
      {SCORE_KEYS.map((key) => {
        const delta = trend.change?.[key] ?? 0;
        const deltaText = delta > 0
          ? t('history.trendUp', { value: delta })
          : delta < 0
            ? t('history.trendDown', { value: Math.abs(delta) })
            : t('history.trendSame');
        const label = t(`debrief.scores.${key}`);
        return (
          <View
            key={key}
            style={styles.row}
            accessible
            accessibilityLabel={t('history.trendRowLabel', {
              label,
              scores: trend.points.map((p) => p.scores[key]).join(', '),
              change: deltaText,
            })}
          >
            <View style={styles.rowHeader}>
              <Text style={[styles.rowLabel, { color: colors.white }]} numberOfLines={1}>{label}</Text>
              <Text
                style={[
                  styles.delta,
                  { color: delta > 0 ? colors.green : delta < 0 ? colors.coral : colors.inkSoft },
                ]}
              >
                {latest[key]}/5 · {deltaText}
              </Text>
            </View>
            <View style={[styles.bars, { borderBottomColor: colors.inkSoft }]}>
              {trend.points.map((point, i) => {
                const isLatest = i === trend.points.length - 1;
                return (
                  <View
                    key={`${point.at}-${i}`}
                    style={[
                      styles.bar,
                      {
                        height: Math.max(3, (point.scores[key] / 5) * BAR_MAX),
                        backgroundColor: isLatest ? colors.coral : colors.primary,
                        opacity: isLatest ? 1 : 0.55 + (0.45 * i) / Math.max(1, trend.points.length - 1),
                      },
                    ]}
                  />
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, padding: 16, marginBottom: 14 },
  title: { fontSize: 15, fontWeight: '700' },
  body: { fontSize: 12, lineHeight: 17, marginTop: 2, marginBottom: 10 },
  row: { marginTop: 8 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 },
  rowLabel: { fontSize: 12, fontWeight: '600', flexShrink: 1 },
  delta: { fontSize: 11, fontWeight: '600', marginLeft: 8 },
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    height: BAR_MAX,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bar: { flex: 1, maxWidth: 22, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
});
