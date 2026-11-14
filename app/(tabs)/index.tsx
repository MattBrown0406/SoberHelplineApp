import React, { useCallback, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, type LayoutChangeEvent, type ScrollView } from 'react-native';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { useTranslation } from 'react-i18next';
import { appAlert } from '../../src/lib/appAlert';
import { useAccount } from '../../src/contexts/AccountContext';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useFocusEffect, useRouter } from 'expo-router';
import { TodayDisclosure, TodayDisclosureToggle } from '../../src/components/today/TodayDisclosure';
import { NextStepItem, useNextStep } from '../../src/components/today/NextStepItem';
import { WelcomeBackCard } from '../../src/components/today/WelcomeBackCard';
import { ReminderAskNote } from '../../src/components/reminders/ReminderAskNote';
import { HeroCard } from '../../src/components/today/HeroCard';
import { CheckInFeedbackCard } from '../../src/components/today/CheckInFeedbackCard';
import { GuidedStartPanel } from '../../src/components/today/GuidedStartPanel';
import { CheckInCard } from '../../src/components/today/CheckInCard';
import { RecoveryPathwayCard } from '../../src/components/today/RecoveryPathwayCard';
import { MoodChart } from '../../src/components/today/MoodChart';
import { FreeTierPaywall } from '../../src/components/ui/FreeTierPaywall';
import { SituationCard, type WeeklyOneThing } from '../../src/components/today/SituationCard';
import { NeedsRouter } from '../../src/components/today/NeedsRouter';
import { ContinueLetterCard } from '../../src/components/today/ContinueLetterCard';
import { WeekReviewCard } from '../../src/components/today/WeekReviewCard';
import { ScriptCard } from '../../src/components/scripts/ScriptCard';
import { HoldLogCard } from '../../src/components/boundaries/HoldLogCard';
import { CurriculumCard } from '../../src/components/today/CurriculumCard';
import { WillingnessWindowAlert } from '../../src/components/today/WillingnessWindowAlert';
import { PassItOnCard } from '../../src/components/today/PassItOnCard';
import { InvitationTodayCard } from '../../src/components/invitation/InvitationTodayCard';
import { LovedOneCheckCard } from '../../src/components/today/LovedOneCheckCard';
import { HolidayPlanTodayCard } from '../../src/components/today/HolidayPlanTodayCard';
import { GriefCard } from '../../src/components/bereavement/GriefCard';
import { BereavementSheet } from '../../src/components/bereavement/BereavementSheet';
import { useCheckIn } from '../../src/hooks/useCheckIn';
import { useTodayFeed } from '../../src/hooks/useTodayFeed';
import { useLovedOne } from '../../src/hooks/useLovedOne';
import { useFamilySpace } from '../../src/hooks/useFamilySpace';
import { useHoldLog } from '../../src/hooks/useHoldLog';
import { useFamilyCallTakeaway } from '../../src/hooks/useFamilyCallTakeaway';
import { useWelcomeBack } from '../../src/hooks/useWelcomeBack';
import { useTodayReminderAsk } from '../../src/hooks/useReminderAsk';
import { rearmDailyNudge } from '../../src/hooks/usePushNotifications';
import { getDailyScripts } from '../../src/content/scripts';
import { PHASE_LABEL_KEY, selectCurriculumPiece } from '../../src/content/curriculum';
import { useFeatureAccess } from '../../src/hooks/useFeatureAccess';
import { pathwayPhaseUpdate } from '../../src/lib/recoveryPathway';
import { NEXT_STEP_PRIORITY, type NextStepCard } from '../../src/lib/todayNextStep';
import { welcomeBackActions } from '../../src/lib/welcomeBack';
import { isFamilySquaresSession, isLaSobremesaSession } from '../../src/lib/familySquaresSchedule';
import {
  cancelQueuedSupportCallReview,
  maybeRequestReview,
  queueSupportCallReview,
} from '../../src/lib/reviewPrompt';

import type { HoldResult } from '../../src/hooks/useHoldLog';
import type { CaregiverCheckInInput } from '../../src/api/types';
import type { TFunction } from 'i18next';

export default function TodayScreen() {
  const { user } = useAccount();
  // Reset account-scoped feeds and draft state together, not only the form.
  return <TodayContent key={user?.id ?? 'signed-out'} />;
}

function TodayContent() {
  const { user, isAttached, isAdmin } = useAccount();
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('today');
  const router = useRouter();
  const { todayCheckIn, streak, saveCheckIn, pendingSync } = useCheckIn(user?.id ?? null, user?.timezone);
  const { lovedOne, loading: lovedOneLoading, loadError: lovedOneLoadError, save: saveLovedOne, markDied, setQuiet, refresh: refreshLovedOne, bereaved: bereavedState } = useLovedOne(user?.id ?? null);
  // Her loved one died: Today shows the grief card instead of everything about them.
  // The device's copy answers before the record loads (or offline), so a
  // bereaved member never sees the loved-one Today first.
  const bereaved = bereavedState === true;
  const bereavedUnknown = bereavedState === undefined;
  const [diedSheetOpen, setDiedSheetOpen] = useState(false);
  const { dayCount, boundariesHeld, groupSessions, quoteIndex, scriptSlot, curriculumWeek, curriculumPhase, situation, primaryDoor, nextFreeCall, rsvpFreeCall, declineFreeCall, reload: reloadFeed } =
    useTodayFeed(user?.id ?? null, user?.joinedAt ?? null);
  const youLabel = user?.firstName || t('boundaries:journal.you');
  const { space: familySpace, refresh: refreshFamilySpace } = useFamilySpace(user?.id ?? null, { you: youLabel, member: t('boundaries:journal.member') });
  const holdLog = useHoldLog(user?.id ?? null, familySpace?.id ?? null, user?.timezone);
  const { reload: reloadHoldLog } = holdLog;
  // Today keeps its own copy of the family space and hold log (both tabs stay
  // mounted): re-read them whenever Today comes into view.
  useFocusEffect(
    useCallback(() => {
      void refreshFamilySpace();
      void reloadHoldLog().catch(() => undefined);
      // Settings can mark or undo "They died" while Today stays mounted.
      void refreshLovedOne().catch(() => undefined);
    }, [refreshFamilySpace, reloadHoldLog, refreshLovedOne]),
  );
  const canAccessFullToday = useFeatureAccess('todayFull');
  const takeaway = useFamilyCallTakeaway(user?.id ?? null);
  // Back after a week or more away: one small hello at the top, for this visit.
  const welcome = useWelcomeBack(user?.id ?? null);
  // A gentle second chance to turn on reminders. Not on the bereaved Today,
  // and not on a visit that opened with the welcome-back card (or before we
  // know whether it did).
  const reminderAsk = useTodayReminderAsk(bereaved || bereavedUnknown ? null : user?.id ?? null, user?.joinedAt, !welcome.ready || welcome.returned);
  // The one "next step" under the check-in, and what waits under "More for this week".
  const nextStep = useNextStep();
  const [moreOpen, setMoreOpen] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const checkInY = useRef(0);
  const scrollToCheckIn = useRef(false);

  const firstName = user?.firstName?.trim() ?? '';
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
            bereaved,
          },
        });
      }, 750);
    }
  }

  function queueMondayMeetingReview(): Promise<void> {
    return queueSupportCallReview({
      accountId: user?.id ?? null,
      safety: { situationBand: situation.band, bereaved },
    });
  }

  async function saveBoundaryWin(result: HoldResult, share: boolean): Promise<void> {
    let newlyHeld = false;
    try {
      newlyHeld = await holdLog.save(result, share);
    } catch {
      // Same message as the Boundaries tab's hold log.
      appAlert(i18n.t('alignment:holdLog.errorTitle'), i18n.t('alignment:holdLog.errorMessage'));
      return;
    }
    if (!newlyHeld) return;
    setTimeout(() => {
      void maybeRequestReview({
        accountId: user?.id ?? null,
        milestone: 'boundary_follow_through',
        safety: { situationBand: situation.band, bereaved },
      });
    }, 750);
  }

  const lovedOneStatus = lovedOne?.status ?? situation.drivers.loved_one_status;
  // Treatment or recovery also clears a stale using/escalating/crisis
  // status; then re-read the situation so Today reflects it. "Still the
  // same" on the loved-one check only re-confirms the phase.
  const saveLovedOnePhase = async (stage: Parameters<typeof pathwayPhaseUpdate>[0], unchanged = false) => {
    const saved = await saveLovedOne(unchanged ? { stage } : pathwayPhaseUpdate(stage, lovedOneStatus));
    void reloadFeed();
    return saved;
  };
  const pathwayCard = (
    <RecoveryPathwayCard
      stage={lovedOne?.stage}
      status={lovedOneStatus}
      loading={lovedOneLoading}
      onSavePhase={saveLovedOnePhase}
      onTheyDied={() => setDiedSheetOpen(true)}
    />
  );
  // Signup lets her skip the loved-one step: ask again on Today, in one tap.
  const lovedOneCheckCard = (
    <LovedOneCheckCard
      accountId={user?.id ?? null}
      lovedOne={lovedOne}
      ready={!lovedOneLoading && !lovedOneLoadError}
      pressureScore={todayCheckIn?.pressureScore}
      onSavePhase={saveLovedOnePhase}
      onTheyDied={() => setDiedSheetOpen(true)}
    />
  );
  const bereavementSheet = (
    <BereavementSheet
      visible={diedSheetOpen}
      onCancel={() => setDiedSheetOpen(false)}
      onConfirm={async (contact, quiet) => {
        const { quietFailed } = await markDied(contact, quiet);
        if (quietFailed) appAlert(t('bereavement.grief.quietError'));
        // The device's own reminders follow the server's pause.
        void rearmDailyNudge().catch(() => undefined);
        setDiedSheetOpen(false);
        void reloadFeed();
      }}
    />
  );
  const holidayCard = <HolidayPlanTodayCard accountId={user?.id ?? null} />;
  const willingnessWindowAlert = (
    <WillingnessWindowAlert accountId={user?.id ?? null} situation={situation} />
  );
  // Invitation Engine: the free pattern-map hook for every tier; daily moves
  // and the receptivity forecast once a member is set up.
  const invitationCard = (
    <InvitationTodayCard accountId={user?.id ?? null} timezone={user?.timezone} />
  );
  // Null when the band is elevated/crisis and no crisis-safe piece fits: a
  // family whose week is on fire gets the support surface, not an exercise.
  const curriculumPiece = selectCurriculumPiece(curriculumWeek, situation.band, i18n.language);
  // This week's one thing: Matt's line from The Family Squares (English call)
  // when he wrote one, otherwise her own week's practice.
  // A week on fire has no exercise: then the one thing is leaning on the
  // support doors the card shows below it.
  const weeklyOneThing: WeeklyOneThing | null = bereaved ? null : takeaway && !i18n.language.startsWith('es')
    ? { text: takeaway.body, fromCall: true }
    : curriculumPiece ? { text: curriculumPiece.practice, fromCall: false }
      : primaryDoor !== 'free_call' ? { text: t('situationCta.oneThingSupport'), fromCall: false } : null;
  // The free Monday call leads Today, right after immediate help: saving a
  // seat is the first thing a new member is asked to do.
  const mondayCallCard = (
    <SituationCard
      accountId={user?.id ?? null}
      nextFreeCall={nextFreeCall}
      // No coaching or intervention door about a loved one who died.
      primaryDoor={bereaved ? 'free_call' : primaryDoor}
      weeklyOneThing={weeklyOneThing}
      onRsvp={rsvpFreeCall}
      onDecline={declineFreeCall}
      onSupportCallJoin={queueMondayMeetingReview}
      onSupportCallOpenFailed={() => cancelQueuedSupportCallReview(user?.id ?? null)}
    />
  );

  const header = (
    <View style={styles.headerRow}>
      <Text style={[styles.greeting, { color: colors.ink }]}>{greeting}</Text>
      <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
        <Text style={styles.avatarText}>{firstName ? firstName.charAt(0).toUpperCase() : '•'}</Text>
      </View>
    </View>
  );

  const checkInCard = (
    <CheckInCard
      key={user?.id ?? 'signed-out'}
      checkIn={todayCheckIn}
      onComplete={completeCheckIn}
      newStreak={streak.currentStreak}
      graceUsed={streak.graceUsed ?? false}
      isAttached={isAttached}
      orgName={user?.branding?.orgName ?? null}
      lowMoodDays={situation.drivers.low_mood_days}
      onTalkToCoach={isAttached ? undefined : () => router.push('/book-coaching')}
      pendingSync={pendingSync}
    />
  );

  const onCheckInLayout = (event: LayoutChangeEvent) => {
    checkInY.current = event.nativeEvent.layout.y;
    // "Check in" on the welcome-back card: scroll once the card above has gone.
    if (!scrollToCheckIn.current) return;
    scrollToCheckIn.current = false;
    scrollRef.current?.scrollTo({ y: Math.max(0, checkInY.current - 8), animated: true });
  };
  // The Monday meeting she can still save a seat at (not one she already answered for).
  const seatOpen = !!nextFreeCall && (isFamilySquaresSession(nextFreeCall) || isLaSobremesaSession(nextFreeCall))
    && !nextFreeCall.rsvped && !nextFreeCall.declined;
  // Either action (or Close) puts the card away until the next week-long gap.
  const welcomeBackCard = welcome.visible ? (
    <WelcomeBackCard
      actions={welcomeBackActions({ seatOpen, checkedInToday: !!todayCheckIn })}
      onSaveSeat={() => {
        welcome.dismiss();
        void rsvpFreeCall();
      }}
      onCheckIn={() => {
        scrollToCheckIn.current = true;
        welcome.dismiss();
      }}
      onDismiss={welcome.dismiss}
    />
  ) : null;
  const reminderAskCard = <ReminderAskNote ask={reminderAsk} place="today" />;

  // One "next step" under the check-in: the first of these with something to
  // show takes the slot (chooseNextStep); the rest wait under "More for this
  // week". Each card still decides for itself whether it shows.
  const nextStepCards: Record<NextStepCard, React.ReactNode> = {
    willingnessWindow: willingnessWindowAlert,
    lovedOneCheck: lovedOneCheckCard,
    holidayPlan: holidayCard,
    invitation: invitationCard,
    guidedStart: <GuidedStartPanel />,
  };
  const nextStepItem = (card: NextStepCard, shown: boolean) => (
    <NextStepItem key={card} shown={shown} onShowing={(showing) => nextStep.report(card, showing)}>
      {nextStepCards[card]}
    </NextStepItem>
  );
  // Both lists go into one keyed list on the screen, so a card stays mounted
  // (and keeps what she typed) when it moves between the slot and "More".
  const nextStepSlot = nextStep.slot ? [nextStepItem(nextStep.slot, true)] : [];
  const moreForThisWeek = [
    ...(nextStep.more.length ? [
      <TodayDisclosureToggle
        key="more"
        title={t('disclosure.more')}
        expanded={moreOpen}
        onPress={() => setMoreOpen((open) => !open)}
      />,
    ] : []),
    ...NEXT_STEP_PRIORITY.filter((card) => card !== nextStep.slot)
      .map((card) => nextStepItem(card, moreOpen && nextStep.more.includes(card))),
  ];

  // The Monday call and the daily check-in lead for every membership tier.
  // After her loved one died: immediate help, the grief card, the Monday call
  // and her own check-in — nothing about their recovery.
  // A moment on a cold start: neither the record nor the device's copy is known.
  // Emergency numbers are right for anyone, so they show even now.
  if (bereavedUnknown) {
    return (
      <ScreenContainer backgroundColor={colors.cream}>
        {header}
        <NeedsRouter bereaved />
      </ScreenContainer>
    );
  }
  if (bereaved) {
    return (
      <ScreenContainer backgroundColor={colors.cream}>
        {header}
        <NeedsRouter bereaved />
        <GriefCard
          quiet={lovedOne?.bereavement_quiet === true}
          onSetQuiet={async (quiet) => {
            await setQuiet(quiet);
            void rearmDailyNudge().catch(() => undefined);
          }}
        />
        {mondayCallCard}
        {checkInCard}
        <CheckInFeedbackCard checkIn={todayCheckIn} />
        <MoodChart accountId={user?.id ?? null} timezone={user?.timezone} />
        {isAdmin && (
          <TouchableOpacity onPress={() => router.push('/admin')} style={styles.adminLink}>
            <Text style={[styles.adminLinkText, { color: colors.inkSoft }]}>Admin</Text>
          </TouchableOpacity>
        )}
      </ScreenContainer>
    );
  }

  // Secondary content stays reachable without overwhelming the first screen:
  // greeting, the Monday call, the check-in, one next step, then "What do you
  // need right now?" and the tucked-away sections.
  if (!canAccessFullToday) {
    const freeScript = getDailyScripts(scriptSlot, i18n.language)[0];
    return (
      <ScreenContainer backgroundColor={colors.cream} scrollRef={scrollRef}>
        {header}
        {welcomeBackCard}
        {mondayCallCard}
        {reminderAskCard}
        <View onLayout={onCheckInLayout}>
          {checkInCard}
          <CheckInFeedbackCard checkIn={todayCheckIn} />
        </View>
        {[...nextStepSlot, <NeedsRouter key="needs" />, ...moreForThisWeek]}
        <TodayDisclosure title={t('disclosure.pathway')}>
          {pathwayCard}
        </TodayDisclosure>
        <TodayDisclosure title={t('disclosure.invite')}>
        <PassItOnCard />
        </TodayDisclosure>
        <TodayDisclosure title={t('disclosure.practice')}>
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
          nameFor={(id) => familySpace?.members.find((m) => m.accountId === id)?.displayName ?? youLabel}
          onSave={(result, share) => { void saveBoundaryWin(result, share); }}
        />
        <MoodChart accountId={user?.id ?? null} timezone={user?.timezone} />
        {curriculumPiece && (
          <CurriculumCard
            piece={curriculumPiece}
            week={curriculumWeek}
            phaseLabel={t(PHASE_LABEL_KEY[curriculumPhase])}
          />
        )}
        </TodayDisclosure>
        <TodayDisclosure title={t('disclosure.membership')}>
          <FreeTierPaywall inline />
        </TodayDisclosure>
        {bereavementSheet}
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer backgroundColor={colors.cream} scrollRef={scrollRef}>
      {header}
      {welcomeBackCard}
      {mondayCallCard}
      {reminderAskCard}
      <View onLayout={onCheckInLayout}>
        {checkInCard}
        <CheckInFeedbackCard checkIn={todayCheckIn} />
      </View>
      {[...nextStepSlot, <NeedsRouter key="needs" />, ...moreForThisWeek]}
      <TodayDisclosure title={t('disclosure.pathway')}>
        {pathwayCard}
      </TodayDisclosure>
      <TodayDisclosure title={t('disclosure.invite')}>
      <PassItOnCard />
      </TodayDisclosure>
      <TodayDisclosure title={t('disclosure.practice')}>
      <HeroCard
        dayCount={dayCount}
        contextLabel={contextLabel}
        quote={dailyQuote}
        checkInStreak={streak.currentStreak}
        boundariesHeld={boundariesHeld}
        groupSessions={groupSessions}
      />

      <HoldLogCard
        own={holdLog.own}
        shared={holdLog.shared}
        saving={holdLog.saving}
        canShare={!!familySpace}
        nameFor={(id) => familySpace?.members.find((m) => m.accountId === id)?.displayName ?? youLabel}
        onSave={(result, share) => { void saveBoundaryWin(result, share); }}
      />

      <ContinueLetterCard accountId={user?.id ?? null} />

      <WeekReviewCard accountId={user?.id ?? null} boundariesHeld={boundariesHeld} />

      <MoodChart accountId={user?.id ?? null} timezone={user?.timezone} />

      {curriculumPiece && (
        <CurriculumCard
          piece={curriculumPiece}
          week={curriculumWeek}
          phaseLabel={t(PHASE_LABEL_KEY[curriculumPhase])}
        />
      )}
      </TodayDisclosure>
      {isAdmin && (
        <TouchableOpacity onPress={() => router.push('/admin')} style={styles.adminLink}>
          <Text style={[styles.adminLinkText, { color: colors.inkSoft }]}>Admin</Text>
        </TouchableOpacity>
      )}
      {bereavementSheet}
    </ScreenContainer>
  );
}

function timeGreeting(t: TFunction<'today'>, name: string): string {
  const h = new Date().getHours();
  const period = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  // No name on file: a complete greeting, not an English placeholder name.
  return name ? t(`greeting.${period}`, { name }) : t(`greeting.${period}NoName`);
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
