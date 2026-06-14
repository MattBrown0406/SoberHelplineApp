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
import { getMockTodayFeed } from '../../src/api/mock';

export default function TodayScreen() {
  const { user, isAttached } = useAccount();
  const { colors } = useTheme();
  const { t } = useTranslation('today');
  const { todayCheckIn, streak, saveCheckIn } = useCheckIn(user?.id ?? null);

  // TODO: replace with useSWR / React Query against GET /today-feed
  const feed = getMockTodayFeed();

  const firstName = user?.firstName ?? 'there';
  const greeting = timeGreeting(t, firstName);

  return (
    <ScreenContainer backgroundColor={colors.cream}>
      <View style={styles.headerRow}>
        <Text style={[styles.greeting, { color: colors.ink }]}>{greeting}</Text>
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Text style={styles.avatarText}>{firstName.charAt(0).toUpperCase()}</Text>
        </View>
      </View>

      <HeroCard
        dayCount={feed.dayCount}
        contextLabel={feed.contextLabel}
        quote={feed.dailyQuote}
        checkInStreak={streak.currentStreak}
        boundariesHeld={feed.boundariesHeld}
        groupSessions={feed.groupSessions}
      />

      <CheckInCard
        completed={todayCheckIn !== null}
        selectedMood={todayCheckIn?.moodScore ?? null}
        onComplete={saveCheckIn}
        newStreak={streak.currentStreak}
        isAttached={isAttached}
        orgName={user?.branding?.orgName ?? null}
      />

      <FocusCard items={feed.focus} />
    </ScreenContainer>
  );
}

import type { TFunction } from 'i18next';

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
