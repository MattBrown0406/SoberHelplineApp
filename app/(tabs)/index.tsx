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
import { HoldLogCard } from '../../src/components/boundaries/HoldLogCard';
import { CurriculumCard } from '../../src/components/today/CurriculumCard';
import { WillingnessWindowAlert } from '../../src/components/today/WillingnessWindowAlert';
import { useCheckIn } from '../../src/hooks/useCheckIn';
import { useTodayFeed } from '../../src/hooks/useTodayFeed';
import { useLovedOne } from '../../src/hooks/useLovedOne';
import { useFamilySpace } from '../../src/hooks/useFamilySpace';
import { useHoldLog } from '../../src/hooks/useHoldLog';
import { getDailyScripts } from '../../src/content/scripts';
import { PHASE_LABEL_KEY, selectCurriculumPiece } from '../../src/content/curriculum';
import { useFeatureAccess } from '../../src/hooks/useFeatureAccess';
import { maybeRequestReview, queueSupportCallReview } from '../../src/lib/reviewPrompt';
import type { CaregiverCheckInInput } from '../../src/api/types';
import type { TFunction } from 'i18next';

export default function TodayScreen() {
  const { user, isAttached, isAdmin } = useAccount();
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('today');
  const router = useRouter();
  const { todayCheckIn, streak, saveCheckIn } = useCheckIn(user?.id ?? null, user?.timezone);
  const { lovedOne, loading: lovedOneLoading, save: saveLovedOne } = useLovedOne(user?.id ?? null);
  const { dayCount, boundariesHeld, groupSessions, quoteIndex, scriptSlot, curriculumWeek, curriculumPhase, situation, primaryDoor, nextFreeCall, rsvpFreeCall } =
    useTodayFeed(user?.id ?? null, user?.joinedAt ?? null);
  const { space: familySpace } = useFamilySpace(user?.id ?? null, user?.firstName || 'You');
  const holdLog = useHoldLog(user?.id ?? null, familySpace?.id ?? null);
  const canAccessFullToday = useFeatureAccess('todayFull');

  const firstName = user?.firstName ?? 'there';
  const greeting = timeGreeting(t, firstName);
  const contextLabel = t(isAttached ? 'hero.contextAttached' : 'hero.contextDirect');
  const dailyQuote = t(`dailyQuote.${quoteIndex}`);
  async function completeCheckIn(input: CaregiverCheckInInput): Promise<void> {
    const nextStreak = await saveCheckIn(input);
    if (nextStreak.currentStreak === 7) {
      setTimeout(() => {
        void maybeRequestReview({
          accountId: user?.id ?? null,
          milestone: 'check_in_streak_7',
          safety: {
            situationBand: situation.band,
            checkIn: input,
          },
        });
      }, 750);
    }
  }

  function queueMondayMeetingReview(): Promise<void> {
    return queueSupportCallReview({
      accountId: user?.id ?? null,
      safety: { situationBand: situation.band },
    });
  }

  const pathwayCard = (
    <RecoveryPathwayCard
      stage={lovedOne?.stage}
      status={lovedOne?.status ?? situation.drivers.loved_one_status}
      loading={lovedOneLoading}
      onSavePhase={(stage) => saveLovedOne({ stage })}
    />
  );
  const willingnessWindowAlert = (
    <WillingnessWindowAlert accountId={user?.id ?? null} situation={situation} />
  );
  // Null when the band is elevated/crisis and no crisis-safe piece fits: a
  // family whose week is on fire gets the support surface, not an exercise.
  const curriculumPiece = selectCurriculumPiece(curriculumWeek, situation.band, i18n.language);

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
      onComplete={completeCheckIn}
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
  if (!canAccessFullToday) {
    const freeScript = getDailyScripts(scriptSlot, i18n.language)[0];
    return (
      <ScreenContainer backgroundColor={colors.cream}>
        {header}
        {willingnessWindowAlert}
        <SituationCard
          nextFreeCall={nextFreeCall}
          primaryDoor={primaryDoor}
          onRsvp={rsvpFreeCall}
          onSupportCallJoin={queueMondayMeetingReview}
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
        <HoldLogCard
          own={holdLog.own}
          shared={holdLog.shared}
          saving={holdLog.saving}
          canShare={!!familySpace}
          nameFor={(id) => familySpace?.members.find((m) => m.accountId === id)?.displayName ?? (user?.firstName || 'You')}
          onSave={(result, share) => { void holdLog.save(result, share); }}
        />
        <MoodChart accountId={user?.id ?? null} />
        {curriculumPiece && (
          <CurriculumCard
            piece={curriculumPiece}
            week={curriculumWeek}
            phaseLabel={t(PHASE_LABEL_KEY[curriculumPhase])}
          />
        )}
        <FreeTierPaywall inline />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer backgroundColor={colors.cream}>
      {header}

      {willingnessWindowAlert}

      <SituationCard
        nextFreeCall={nextFreeCall}
        primaryDoor={primaryDoor}
        onRsvp={rsvpFreeCall}
        onSupportCallJoin={queueMondayMeetingReview}
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

      <HoldLogCard
        own={holdLog.own}
        shared={holdLog.shared}
        saving={holdLog.saving}
        canShare={!!familySpace}
        nameFor={(id) => familySpace?.members.find((m) => m.accountId === id)?.displayName ?? (user?.firstName || 'You')}
        onSave={(result, share) => { void holdLog.save(result, share); }}
      />

      <ContinueLetterCard accountId={user?.id ?? null} />

      <WeekReviewCard accountId={user?.id ?? null} boundariesHeld={boundariesHeld} />

      <MoodChart accountId={user?.id ?? null} />

      {curriculumPiece && (
        <CurriculumCard
          piece={curriculumPiece}
          week={curriculumWeek}
          phaseLabel={t(PHASE_LABEL_KEY[curriculumPhase])}
        />
      )}
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
