import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import { useTranslation } from 'react-i18next';
import type { MoodScore } from '../../api/types';

type Row = { created_at: string; mood_score: MoodScore };

const BAR_H = 56;

function moodColor(score: MoodScore, coral: string, green: string): string {
  if (score <= 2) return coral;
  if (score === 3) return '#e6c070';
  return green;
}

export function MoodChart({ accountId }: { accountId: string | null }) {
  const { colors } = useTheme();
  const { t } = useTranslation('today');
  const [rows, setRows] = useState<Row[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!accountId) return;
      const since = new Date(Date.now() - 14 * 86400000).toISOString();
      void supabase
        .from('checkins')
        .select('created_at, mood_score')
        .eq('account_id', accountId)
        .gte('created_at', since)
        .order('created_at', { ascending: true })
        .then(({ data }) => {
          if (data) setRows(data as Row[]);
        });
    }, [accountId]),
  );

  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86400000);
    return d.toISOString().slice(0, 10);
  });

  const byDate = new Map<string, MoodScore>();
  rows.forEach((r) => byDate.set(r.created_at.slice(0, 10), r.mood_score));

  return (
    <View style={[styles.card, { borderColor: colors.line }]}>
      <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
        {t('moodChart.eyebrow')}
      </Text>

      {rows.length === 0 ? (
        <Text style={[styles.empty, { color: colors.inkSoft }]}>
          {t('moodChart.noData')}
        </Text>
      ) : (
        <>
          <View style={styles.chartRow}>
            {days.map((date, i) => {
              const score = byDate.get(date);
              const isToday = i === 13;
              const barH = score ? (score / 5) * BAR_H : 2;
              const barColor = score
                ? moodColor(score, colors.coral, colors.green)
                : colors.line;
              return (
                <View key={date} style={styles.barWrap}>
                  <View style={[styles.barTrack, { height: BAR_H }]}>
                    <View
                      style={[
                        styles.bar,
                        {
                          height: barH,
                          backgroundColor: barColor,
                          opacity: score ? (isToday ? 1 : 0.78) : 1,
                          borderRadius: score ? 3 : 1,
                        },
                      ]}
                    />
                  </View>
                  {isToday && (
                    <View style={[styles.todayDot, { backgroundColor: colors.primary }]} />
                  )}
                </View>
              );
            })}
          </View>

          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: colors.coral }]} />
            <Text style={[styles.legendText, { color: colors.inkSoft }]}>Hard</Text>
            <View style={[styles.legendDot, { backgroundColor: '#e6c070', marginLeft: 10 }]} />
            <Text style={[styles.legendText, { color: colors.inkSoft }]}>Okay</Text>
            <View style={[styles.legendDot, { backgroundColor: colors.green, marginLeft: 10 }]} />
            <Text style={[styles.legendText, { color: colors.inkSoft }]}>Good</Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    shadowColor: '#22302f',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 14,
  },
  empty: {
    fontSize: 13,
    lineHeight: 18,
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    marginBottom: 10,
  },
  barWrap: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  barTrack: {
    width: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: '#f4f4f2',
    borderRadius: 4,
  },
  bar: {
    width: '100%',
  },
  todayDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 11,
  },
});
