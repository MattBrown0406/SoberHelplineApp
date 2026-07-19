import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { useTranslation } from 'react-i18next';
import { useAccount } from '../../src/contexts/AccountContext';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useRouter } from 'expo-router';
import { HeroCard } from '../../src/components/today/HeroCard';
import { CheckInCard } from '../../src/components/today/CheckInCard';
import { FocusCard } from '../../src/components/today/FocusCard';
import { MoodChart } from '../../src/components/today/MoodChart';
import { FreeTierPaywall } from '../../src/components/ui/FreeTierPaywall';
import { SituationCard } from '../../src/components/today/SituationCard';
import { NeedsRouter } from '../../src/components/today/NeedsRouter';
import { ContinueLetterCard } from '../../src/components/today/ContinueLetterCard';
import { WeekReviewCard } from '../../src/components/today/WeekReviewCard';
import { ScriptCard } from '../../src/components/scripts/ScriptCard';
import { useCheckIn } from '../../src/hooks/useCheckIn';
import { useTodayFeed } from '../../src/hooks/useTodayFeed';
import { getDailyScriptPair } from '../../src/content/scripts';
import { isAdminEmail } from '../../src/lib/admin';
import type { DailyFocusItem } from '../../src/api/types';
import type { TFunction } from 'i18next';

export default function TodayScreen() {
  const { user, isAttached, accountState } = useAccount();
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('today');
  const router = useRouter();
  const { todayCheckIn, streak, saveCheckIn } = useCheckIn(user?.id ?? null);
  const { dayCount, boundariesHeld, groupSessions, quoteIndex, focusSlot, scriptSlot, situation, primaryDoor, nextFreeCall, rsvpFreeCall } =
    useTodayFeed(user?.id ?? null, user?.joinedAt ?? null);
  const isAdmin = isAdminEmail(user?.email);

  const firstName = user?.firstName ?? 'there';
  const greeting = timeGreeting(t, firstName);
  const contextLabel = t(isAttached ? 'hero.contextAttached' : 'hero.contextDirect');
  const dailyQuote = t(`dailyQuote.${quoteIndex}`);
  const focusItems = buildFocusItems(t, focusSlot);

  const header = (
    <View style={styles.headerRow}>
      <Text style={[styles.greeting, { color: colors.ink }]}>{greeting}</Text>
      <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
        <Text style={styles.avatarText}>{firstName.charAt(0).toUpperCase()}</Text>
      </View>
    </View>
  );

  const checkInCard = (
    <CheckInCard
      completed={todayCheckIn !== null}
      selectedMood={todayCheckIn?.moodScore ?? null}
      onComplete={saveCheckIn}
      newStreak={streak.currentStreak}
      graceUsed={streak.graceUsed ?? false}
      isAttached={isAttached}
      orgName={user?.branding?.orgName ?? null}
      lowMoodDays={situation.drivers.low_mood_days}
      onTalkToCoach={isAttached ? undefined : () => router.push('/book-coaching')}
    />
  );

  // Free tier: the free call stays the anchor, but the daily loop — check-in,
  // streak, one free script, and the mood arc — is never gated. A habit that
  // exists converts; a paywall in place of a habit does not.
  if (accountState === 'direct-free' && !isAdmin) {
    const freeScript = getDailyScriptPair(scriptSlot, i18n.language)[0];
    return (
      <ScreenContainer backgroundColor={colors.cream}>
        {header}
        <SituationCard
          nextFreeCall={nextFreeCall}
          primaryDoor={primaryDoor}
          onRsvp={rsvpFreeCall}
        />
        <NeedsRouter />
        {checkInCard}
        {freeScript && (
          <>
            <Text style={[styles.sectionLabel, { color: colors.inkSoft }]}>
              {t('freeDaily.eyebrow').toUpperCase()}
            </Text>
            <ScriptCard script={freeScript} />
            <Text style={[styles.freeNote, { color: colors.inkSoft }]}>
              {t('freeDaily.note')}
            </Text>
          </>
        )}
        <MoodChart accountId={user?.id ?? null} />
        <FreeTierPaywall inline />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer backgroundColor={colors.cream}>
      {header}

      <SituationCard
        nextFreeCall={nextFreeCall}
        primaryDoor={primaryDoor}
        onRsvp={rsvpFreeCall}
      />

      <NeedsRouter />

      <HeroCard
        dayCount={dayCount}
        contextLabel={contextLabel}
        quote={dailyQuote}
        checkInStreak={streak.currentStreak}
        boundariesHeld={boundariesHeld}
        groupSessions={groupSessions}
      />

      {checkInCard}

      <ContinueLetterCard accountId={user?.id ?? null} />

      <WeekReviewCard accountId={user?.id ?? null} boundariesHeld={boundariesHeld} />

      <MoodChart accountId={user?.id ?? null} />

      <FocusCard items={focusItems} />

      {isAdmin && (
        <TouchableOpacity onPress={() => router.push('/admin')} style={styles.adminLink}>
          <Text style={[styles.adminLinkText, { color: colors.inkSoft }]}>Admin</Text>
        </TouchableOpacity>
      )}
    </ScreenContainer>
  );
}

function buildFocusItems(t: TFunction<'today'>, slot: number): DailyFocusItem[] {
  const pools: DailyFocusItem[][] = [
    // Day 0 — conversation + boundaries
    [
      { id: 'f-script', icon: '💬', title: t('focus.scriptPractice.title'), subtitle: t('focus.scriptPractice.subtitle'), accentColor: '#e8eef6', actionType: 'script', actionId: null, route: '/(tabs)/scripts' },
      { id: 'f-boundary', icon: '🛡️', title: t('focus.boundaryReview.title'), subtitle: t('focus.boundaryReview.subtitle'), accentColor: '#fdf3e3', actionType: 'exercise', actionId: null, route: '/(tabs)/boundaries' },
    ],
    // Day 1 — letter + breathe
    [
      { id: 'f-letter', icon: '✉️', title: t('focus.letter.title'), subtitle: t('focus.letter.subtitle'), accentColor: '#e8eef6', actionType: 'exercise', actionId: null, route: '/letter' },
      { id: 'f-breathe', icon: '🧘', title: t('focus.breathe.title'), subtitle: t('focus.breathe.subtitle'), accentColor: '#e9f2ec', actionType: null, actionId: null, route: '/rehearsal' },
    ],
    // Day 2 — group + tracker
    [
      { id: 'f-group', icon: '🤝', title: t('focus.group.title'), subtitle: t('focus.group.subtitle'), accentColor: '#e8eef6', actionType: 'reminder', actionId: null, route: '/(tabs)/support' },
      { id: 'f-track', icon: '📊', title: t('focus.tracker.title'), subtitle: t('focus.tracker.subtitle'), accentColor: '#fdf3e3', actionType: 'exercise', actionId: null, route: '/(tabs)/tracker' },
    ],
    // Day 3 — anchor + self care
    [
      { id: 'f-anchor', icon: '⚓', title: t('focus.anchor.title'), subtitle: t('focus.anchor.subtitle'), accentColor: '#e8eef6', actionType: null, actionId: null, route: '/(tabs)/boundaries' },
      { id: 'f-self', icon: '🌿', title: t('focus.selfCare.title'), subtitle: t('focus.selfCare.subtitle'), accentColor: '#e9f2ec', actionType: null, actionId: null, route: null },
    ],
    // Day 4 — support network + enabling check
    [
      { id: 'f-network', icon: '📞', title: t('focus.supportNetwork.title'), subtitle: t('focus.supportNetwork.subtitle'), accentColor: '#e8eef6', actionType: null, actionId: null, route: '/(tabs)/support' },
      { id: 'f-enabling', icon: '🔍', title: t('focus.enabling.title'), subtitle: t('focus.enabling.subtitle'), accentColor: '#fdf3e3', actionType: null, actionId: null, route: '/(tabs)/boundaries' },
    ],
    // Day 5 — research + journal
    [
      { id: 'f-research', icon: '📖', title: t('focus.research.title'), subtitle: t('focus.research.subtitle'), accentColor: '#e8eef6', actionType: null, actionId: null, route: '/(tabs)/learn' },
      { id: 'f-journal', icon: '✏️', title: t('focus.journal.title'), subtitle: t('focus.journal.subtitle'), accentColor: '#e9f2ec', actionType: null, actionId: null, route: '/(tabs)/tracker' },
    ],
    // Day 6 — opening line + check-in
    [
      { id: 'f-opening', icon: '🎯', title: t('focus.openingLine.title'), subtitle: t('focus.openingLine.subtitle'), accentColor: '#e8eef6', actionType: null, actionId: null, route: '/(tabs)/scripts' },
      { id: 'f-checkin', icon: '📋', title: t('focus.dailyCheckIn.title'), subtitle: t('focus.dailyCheckIn.subtitle'), accentColor: '#fdf3e3', actionType: 'reminder', actionId: null, route: null },
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
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 10,
    marginTop: 4,
  },
  freeNote: {
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
    marginBottom: 12,
  },
  adminLink: { alignSelf: 'center', marginTop: 32, paddingVertical: 8, paddingHorizontal: 16 },
  adminLinkText: { fontSize: 12 },
});
