import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  dayCount: number;
  contextLabel: string;
  quote: string;
  checkInStreak: number;
  boundariesHeld: number;
  groupSessions: number;
}

export function HeroCard({
  dayCount,
  contextLabel,
  quote,
  checkInStreak,
  boundariesHeld,
  groupSessions,
}: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('today');

  return (
    <LinearGradient
      colors={[colors.primary, '#2e6da3']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <Text style={styles.eyebrow}>
        {t('hero.dayLabel', { count: dayCount, context: contextLabel })}
      </Text>
      <Text style={styles.quote}>"{quote}"</Text>
      <View style={styles.streakRow}>
        <StreakStat value={checkInStreak} label={t('streak.checkIn')} />
        <StreakStat value={boundariesHeld} label={t('streak.boundaries')} />
        <StreakStat value={groupSessions} label={t('streak.groups')} />
      </View>
    </LinearGradient>
  );
}

function StreakStat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.streakItem}>
      <Text style={styles.streakNum}>{value}</Text>
      <Text style={styles.streakLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
  },
  eyebrow: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '600',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  quote: {
    fontSize: 19,
    fontWeight: '700',
    color: '#fff',
    lineHeight: 26,
    marginBottom: 10,
  },
  streakRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  streakItem: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.13)',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    alignItems: 'center',
    minWidth: 0,
  },
  streakNum: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
  },
  streakLabel: {
    fontSize: 10.5,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
    textAlign: 'center',
  },
});
