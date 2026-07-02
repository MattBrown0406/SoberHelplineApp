import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import type { MoodScore } from '../../api/types';

/**
 * Weekend recap — the longitudinal payoff that makes daily check-ins feel
 * worthwhile. Shown Saturdays and Sundays when the user has at least two
 * check-ins in the last seven days; hidden otherwise so a thin week never
 * reads as a scolding.
 */
export function WeekReviewCard({
  accountId,
  boundariesHeld,
}: {
  accountId: string | null;
  boundariesHeld: number;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('today');
  const [stats, setStats] = useState<{ count: number; avg: number } | null>(null);

  const day = new Date().getDay(); // 0 = Sunday, 6 = Saturday
  const isWeekend = day === 0 || day === 6;

  useEffect(() => {
    if (!accountId || !isWeekend) return;
    let cancelled = false;
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    void supabase
      .from('checkins')
      .select('mood')
      .eq('account_id', accountId)
      .gte('created_at', since)
      .then(({ data }) => {
        if (cancelled || !data || data.length < 2) return;
        const moods = data.map((r) => r.mood as MoodScore);
        const avg = Math.round((moods.reduce((a, b) => a + b, 0) / moods.length) * 10) / 10;
        setStats({ count: moods.length, avg });
      });
    return () => { cancelled = true; };
  }, [accountId, isWeekend]);

  if (!isWeekend || !stats) return null;

  const lines = [
    t('weekReview.checkins', { count: stats.count }),
    t('weekReview.avgMood', { avg: stats.avg }),
    ...(boundariesHeld > 0 ? [t('weekReview.boundaries', { count: boundariesHeld })] : []),
  ];

  return (
    <View style={[styles.card, { borderColor: colors.line }]}>
      <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
        {t('weekReview.eyebrow').toUpperCase()}
      </Text>
      <Text style={[styles.title, { color: colors.ink }]}>{t('weekReview.title')}</Text>
      <View style={styles.statRow}>
        {lines.map((line) => (
          <View key={line} style={[styles.stat, { backgroundColor: colors.primaryLight }]}>
            <Text style={[styles.statText, { color: colors.primary }]}>{line}</Text>
          </View>
        ))}
      </View>
      <Text style={[styles.encourage, { color: colors.inkSoft }]}>
        {t('weekReview.encourage')}
      </Text>
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
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, marginBottom: 6 },
  title: { fontSize: 15, fontWeight: '700', marginBottom: 10 },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 10 },
  stat: { borderRadius: 99, paddingVertical: 6, paddingHorizontal: 12 },
  statText: { fontSize: 12.5, fontWeight: '700' },
  encourage: { fontSize: 12.5, lineHeight: 18 },
});
