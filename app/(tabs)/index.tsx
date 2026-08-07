import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { useTranslation } from 'react-i18next';
import { useAccount } from '../../src/contexts/AccountContext';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useRouter } from 'expo-router';
import { HeroCard } from '../../src/components/today/HeroCard';
import { CheckInCard } from '../../src/components/today/CheckInCard';
import { RecoveryPathwayCard } from '../../src/components/today/RecoveryPathwayCard';
import { MoodChart } from '../../src/components/today/MoodChart';
import { FreeTierPaywall } from '../../src/components/ui/FreeTierPaywall';
import { SituationCard } from '../../src/components/today/SituationCard';
import { NeedsRouter } from '../../src/components/today/NeedsRouter';
import { ContinueLetterCard } from '../../src/components/today/ContinueLetterCard';
import { WeekReviewCard } from '../../src/components/today/WeekReviewCard';
import { ScriptCard } from '../../src/components/scripts/ScriptCard';
import { useCheckIn } from '../../src/hooks/useCheckIn';
import { useTodayFeed } from '../../src/hooks/useTodayFeed';
import { useLovedOne } from '../../src/hooks/useLovedOne';
import { getDailyScripts } from '../../src/content/scripts';
import { isAdminEmail } from '../../src/lib/admin';
import type { TFunction } from 'i18next';

export default function TodayScreen() {
  const { user, isAttached, accountState } = useAccount();
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('today');
  const router = useRouter();
  const { todayCheckIn, streak, saveCheckIn } = useCheckIn(user?.id ?? null, user?.timezone);
  const { lovedOne, loading: lovedOneLoading, save: saveLovedOne } = useLovedOne(user?.id ?? null);
  const { dayCount, boundariesHeld, groupSessions, quoteIndex, scriptSlot, situation, primaryDoor, nextFreeCall, rsvpFreeCall } =
    useTodayFeed(user?.id ?? null, user?.joinedAt ?? null);
  const isAdmin = isAdminEmail(user?.email);

  const firstName = user?.firstName ?? 'there';
  const greeting = timeGreeting(t, firstName);
  const contextLabel = t(isAttached ? 'hero.contextAttached' : 'hero.contextDirect');
  const dailyQuote = t(`dailyQuote.${quoteIndex}`);

  const pathwayCard = (
    <RecoveryPathwayCard
      stage={lovedOne?.stage}
      status={lovedOne?.status ?? situation.drivers.loved_one_status}
      loading={lovedOneLoading}
      onSavePhase={(stage) => saveLovedOne({ stage })}
    />
  );

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
      checkIn={todayCheckIn}
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
    const freeScript = getDailyScripts(scriptSlot, i18n.language)[0];
    return (
      <ScreenContainer backgroundColor={colors.cream}>
        {header}
        <SituationCard
          nextFreeCall={nextFreeCall}
          primaryDoor={primaryDoor}
          onRsvp={rsvpFreeCall}
        />
        <NeedsRouter />
        {pathwayCard}
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

      {pathwayCard}

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

      {isAdmin && (
        <TouchableOpacity onPress={() => router.push('/admin')} style={styles.adminLink}>
          <Text style={[styles.adminLinkText, { color: colors.inkSoft }]}>Admin</Text>
        </TouchableOpacity>
      )}
    </ScreenContainer>
  );
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
