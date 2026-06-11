import React from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  const { todayCheckIn, streak, saveCheckIn } = useCheckIn();

  // TODO: replace with useSWR / React Query against GET /today-feed
  const feed = getMockTodayFeed();

  const greeting = timeGreeting();
  const firstName = user?.firstName ?? 'there';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.cream }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Text style={[styles.greeting, { color: colors.ink }]}>
            {greeting}, {firstName}
          </Text>
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
      </ScrollView>
    </SafeAreaView>
  );
}

function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 20, paddingBottom: 32 },
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
