import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { useTranslation } from 'react-i18next';
import { useAccount } from '../../src/contexts/AccountContext';
import { useTheme } from '../../src/contexts/ThemeContext';
import { HeroCard } from '../../src/components/today/HeroCard';
import { CheckInCard } from '../../src/components/today/CheckInCard';
import { FocusCard } from '../../src/components/today/FocusCard';
import { useCheckIn } from '../../src/hooks/useCheckIn';
import { useTodayFeed } from '../../src/hooks/useTodayFeed';
import type { DailyFocusItem } from '../../src/api/types';
import type { TFunction } from 'i18next';

export default function TodayScreen() {
  const { user, isAttached } = useAccount();
  const { colors } = useTheme();
  const { t } = useTranslation('today');
  const { todayCheckIn, streak, saveCheckIn } = useCheckIn(user?.id ?? null);
  const { dayCount, boundariesHeld, groupSessions, quoteIndex, focusSlot } =
    useTodayFeed(user?.id ?? null, user?.joinedAt ?? null);

  const firstName = user?.firstName ?? 'there';
  const greeting = timeGreeting(t, firstName);
  const contextLabel = t(isAttached ? 'hero.contextAttached' : 'hero.contextDirect');
  const dailyQuote = t(`dailyQuote.${quoteIndex}`);
  const focusItems = buildFocusItems(t, focusSlot);

  return (
    <ScreenContainer backgroundColor={colors.cream}>
      <View style={styles.headerRow}>
        <Text style={[styles.greeting, { color: colors.ink }]}>{greeting}</Text>
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Text style={styles.avatarText}>{firstName.charAt(0).toUpperCase()}</Text>
        </View>
      </View>

      <HeroCard
        dayCount={dayCount}
        contextLabel={contextLabel}
        quote={dailyQuote}
        checkInStreak={streak.currentStreak}
        boundariesHeld={boundariesHeld}
        groupSessions={groupSessions}
      />

      <CheckInCard
        completed={todayCheckIn !== null}
        selectedMood={todayCheckIn?.moodScore ?? null}
        onComplete={saveCheckIn}
        newStreak={streak.currentStreak}
        isAttached={isAttached}
        orgName={user?.branding?.orgName ?? null}
      />

      <FocusCard items={focusItems} />
    </ScreenContainer>
  );
}

function buildFocusItems(t: TFunction<'today'>, slot: number): DailyFocusItem[] {
  const pools: DailyFocusItem[][] = [
    [
      { id: 'f-script', icon: '💬', title: t('focus.scriptPractice.title'), subtitle: t('focus.scriptPractice.subtitle'), accentColor: '#e8eef6', actionType: 'script', actionId: null },
      { id: 'f-boundary', icon: '🛡️', title: t('focus.boundaryReview.title'), subtitle: t('focus.boundaryReview.subtitle'), accentColor: '#fdf3e3', actionType: 'exercise', actionId: null },
      { id: 'f-self', icon: '🌿', title: t('focus.selfCare.title'), subtitle: t('focus.selfCare.subtitle'), accentColor: '#e9f2ec', actionType: null, actionId: null },
    ],
    [
      { id: 'f-checkin', icon: '📋', title: t('focus.dailyCheckIn.title'), subtitle: t('focus.dailyCheckIn.subtitle'), accentColor: '#e8eef6', actionType: 'reminder', actionId: null },
      { id: 'f-letter', icon: '✉️', title: t('focus.letter.title'), subtitle: t('focus.letter.subtitle'), accentColor: '#fdf3e3', actionType: 'exercise', actionId: null },
      { id: 'f-breathe', icon: '🧘', title: t('focus.breathe.title'), subtitle: t('focus.breathe.subtitle'), accentColor: '#e9f2ec', actionType: null, actionId: null },
    ],
    [
      { id: 'f-group', icon: '🤝', title: t('focus.group.title'), subtitle: t('focus.group.subtitle'), accentColor: '#e8eef6', actionType: 'reminder', actionId: null },
      { id: 'f-track', icon: '📊', title: t('focus.tracker.title'), subtitle: t('focus.tracker.subtitle'), accentColor: '#fdf3e3', actionType: 'exercise', actionId: null },
      { id: 'f-anchor', icon: '⚓', title: t('focus.anchor.title'), subtitle: t('focus.anchor.subtitle'), accentColor: '#e9f2ec', actionType: null, actionId: null },
    ],
  ];
  return pools[slot] ?? pools[0];
}

function timeGreeting(t: TFunction<'today'>, name: string): string {
  const h = new Date().getHours();
  const key =
    h < 12 ? 'greeting.morning' : h < 17 ? 'greeting.afternoon' : 'greeting.evening';
  return t(key, { name });
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 8,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
});
