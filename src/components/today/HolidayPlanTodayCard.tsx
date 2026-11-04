import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { useHolidayPlan } from '../../hooks/useHolidayPlan';
import { holidayPlanProgress, holidayPlanStarted, holidaySeason } from '../../lib/holidayPlan';
import { holidayCardStorageKey, holidayCardVisible } from '../../lib/todayPrompts';

/**
 * November 1 to January 6: one card that asks the family to decide the hard
 * parts of the holidays ahead of time. Gone once the plan is ready, or for the
 * rest of the season when she taps "Not this year".
 */
export function HolidayPlanTodayCard({ accountId }: { accountId: string | null }) {
  const { colors } = useTheme();
  const { t } = useTranslation('holidayPlan');
  const router = useRouter();
  const { plan, loadState } = useHolidayPlan(accountId);
  // undefined until the dismissal has been read, so the card never flashes.
  const [dismissedSeason, setDismissedSeason] = useState<string | null | undefined>(undefined);
  const [now, setNow] = useState(() => new Date());

  useFocusEffect(useCallback(() => {
    setNow(new Date());
    if (!accountId) {
      setDismissedSeason(undefined);
      return undefined;
    }
    let cancelled = false;
    AsyncStorage.getItem(holidayCardStorageKey(accountId))
      .then((value) => { if (!cancelled) setDismissedSeason(value); })
      // Unreadable storage: show the card rather than hide it for good.
      .catch(() => { if (!cancelled) setDismissedSeason(null); });
    return () => { cancelled = true; };
  }, [accountId]));

  if (!accountId || dismissedSeason === undefined || loadState !== 'ready') return null;
  const ready = holidayPlanProgress(plan).ready;
  if (!holidayCardVisible({ now, planReady: ready, dismissedSeason })) return null;
  const started = holidayPlanStarted(plan);

  const hide = () => {
    const season = holidaySeason(new Date()).season;
    setDismissedSeason(season);
    void AsyncStorage.setItem(holidayCardStorageKey(accountId), season).catch(() => undefined);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.coral }]}>
      <Text style={[styles.eyebrow, { color: colors.coral }]}>{t('todayCard.eyebrow')}</Text>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
        {started ? t('todayCard.titleStarted') : t('todayCard.titleNew')}
      </Text>
      <Text style={[styles.body, { color: colors.inkSoft }]}>{t('todayCard.body')}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={started ? t('todayCard.continue') : t('todayCard.open')}
        onPress={() => router.push('/holiday-plan' as never)}
        activeOpacity={0.85}
        style={[styles.button, { backgroundColor: colors.coral }]}
      >
        <Text style={styles.buttonText}>{started ? t('todayCard.continue') : t('todayCard.open')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('todayCard.hideAccessibility')}
        onPress={hide}
        style={styles.hide}
      >
        <Text style={[styles.hideText, { color: colors.inkSoft }]}>{t('todayCard.hide')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1.5, borderRadius: 16, padding: 18, marginBottom: 16 },
  eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2, marginBottom: 6 },
  title: { fontSize: 19, lineHeight: 25, fontWeight: '800', marginBottom: 6 },
  body: { fontSize: 14.5, lineHeight: 21, marginBottom: 14 },
  button: { borderRadius: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  hide: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, marginTop: 4 },
  hideText: { fontSize: 13.5, fontWeight: '700' },
});
