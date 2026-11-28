import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, type LayoutChangeEvent, type ScrollView } from 'react-native';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { TabHeader } from '../../src/components/ui/TabHeader';
import { useTranslation } from 'react-i18next';
import { appAlert } from '../../src/lib/appAlert';
import { useAccount } from '../../src/contexts/AccountContext';
import { useTheme } from '../../src/contexts/ThemeContext';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { TodayDisclosure, TodayDisclosureToggle } from '../../src/components/today/TodayDisclosure';
import { NextStepItem, useNextStep } from '../../src/components/today/NextStepItem';
import { WelcomeBackCard } from '../../src/components/today/WelcomeBackCard';
import { ReminderAskNote } from '../../src/components/reminders/ReminderAskNote';
import { HeroCard } from '../../src/components/today/HeroCard';
import { CheckInFeedbackCard } from '../../src/components/today/CheckInFeedbackCard';
import { CheckInCard } from '../../src/components/today/CheckInCard';
import { RecoveryPathwayCard } from '../../src/components/today/RecoveryPathwayCard';
import { PathNextStepCard } from '../../src/components/today/PathNextStepCard';
import { MoodChart } from '../../src/components/today/MoodChart';
import { PlansTeaserCard } from '../../src/components/plans/PlansTeaserCard';
import { ContextualMembershipInvitation } from '../../src/membershipInvitations/ContextualMembershipInvitation';
import { isDifficultCheckIn } from '../../src/lib/reviewPromptPolicy';
import { MondayReflection } from '../../src/components/familySquares/MondayReflection';
import { noteVisitAsk } from '../../src/membershipInvitations/visitAsks';
import { SituationCard, type WeeklyOneThing } from '../../src/components/today/SituationCard';
import { NeedsRouter } from '../../src/components/today/NeedsRouter';
import { ContinueLetterCard } from '../../src/components/today/ContinueLetterCard';
import { WeekReviewCard } from '../../src/components/today/WeekReviewCard';
import { HoldLogCard } from '../../src/components/boundaries/HoldLogCard';
import { CurriculumCard } from '../../src/components/today/CurriculumCard';
import { WillingnessWindowAlert } from '../../src/components/today/WillingnessWindowAlert';
import { InvitationTodayCard } from '../../src/components/invitation/InvitationTodayCard';
import { LovedOneCheckCard } from '../../src/components/today/LovedOneCheckCard';
import { HolidayPlanTodayCard } from '../../src/components/today/HolidayPlanTodayCard';
import { useCheckIn } from '../../src/hooks/useCheckIn';
import { useTodayFeed } from '../../src/hooks/useTodayFeed';
import { useLovedOne } from '../../src/hooks/useLovedOne';
import { useFamilySpace } from '../../src/hooks/useFamilySpace';
import { useHoldLog } from '../../src/hooks/useHoldLog';
import { useFamilyCallTakeaway } from '../../src/hooks/useFamilyCallTakeaway';
import { useWelcomeBack } from '../../src/hooks/useWelcomeBack';
import { useTodayReminderAsk } from '../../src/hooks/useReminderAsk';
import { useToolOpened } from '../../src/hooks/useToolOpened';
import { PHASE_LABEL_KEY, selectCurriculumPiece } from '../../src/content/curriculum';
import { useFeatureAccess } from '../../src/hooks/useFeatureAccess';
import { usePlanOffers } from '../../src/hooks/usePlanPurchase';
import { pathwayPhaseUpdate } from '../../src/lib/recoveryPathway';
import { NEXT_STEP_PRIORITY, type NextStepCard } from '../../src/lib/todayNextStep';
import { welcomeBackActions } from '../../src/lib/welcomeBack';
import { isFamilySquaresSession, isLaSobremesaSession } from '../../src/lib/familySquaresSchedule';
import { isCancelledMeetingDate } from '../../src/lib/familySquaresCancelled';
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
  useToolOpened('today');
  const { user, isAttached, isAdmin } = useAccount();
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('today');
  const router = useRouter();
  const { todayCheckIn, streak, saveCheckIn, pendingSync } = useCheckIn(user?.id ?? null, user?.timezone);
  const { lovedOne, loading: lovedOneLoading, loadError: lovedOneLoadError, save: saveLovedOne, refresh: refreshLovedOne } = useLovedOne(user?.id ?? null);
  const { dayCount, boundariesHeld, groupSessions, quoteIndex, curriculumWeek, curriculumPhase, situation, primaryDoor, nextFreeCall, rsvpFreeCall, seatSavedHere, declineFreeCall, reload: reloadFeed } =
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
      // Another screen can change her loved one's record while Today stays mounted.
      void refreshLovedOne().catch(() => undefined);
    }, [refreshFamilySpace, reloadHoldLog, refreshLovedOne]),
  );
  const canAccessFullToday = useFeatureAccess('todayFull');
  const takeaway = useFamilyCallTakeaway(user?.id ?? null);
  // Back after a week or more away: one small hello at the top, for this visit.
  const welcome = useWelcomeBack(user?.id ?? null);
  // A gentle second chance to turn on reminders. Not on a visit that opened with the welcome-back card (or before we
  // know whether it did: it waits for welcome.decided each time).
  // (Nor "a reminder before Monday's meeting" in a week the website cancelled it.)
  const mondayCancelled = isFamilySquaresSession(nextFreeCall) && isCancelledMeetingDate(nextFreeCall?.cancelledDate);
  const reminderAsk = useTodayReminderAsk(user?.id ?? null, user?.joinedAt, !welcome.ready || welcome.returned, welcome.decided, mondayCancelled);
  // One ask per visit: once the reminder ask has been on Today, no membership
  // invitation is offered anywhere until she next leaves the app (visitAsks).
  const reminderAskOpen = reminderAsk.view === 'ask' || reminderAsk.view === 'settings';
  useEffect(() => {
    if (reminderAskOpen) noteVisitAsk(user?.id ?? null);
  }, [reminderAskOpen, user?.id]);
  // Her check-in streak just reached five days (never the seventh, which is
  // the rating prompt's day). Starts false; true only once that check-in
  // saved, for as long as Today stays in view. Free members only (the
  // invitation checks that).
  const [checkinWeek, setCheckinWeek] = useState(false);
  useFocusEffect(useCallback(() => () => setCheckinWeek(false), []));
  // The one "next step" under the check-in, and everything else in one
  // collapsed "More for you" (mounted the first time she opens it).
  const nextStep = useNextStep();
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreVisited, setMoreVisited] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const checkInY = useRef(0);
  const scrollToCheckIn = useRef(false);
  const moreY = useRef(0);
  const scrollToMore = useRef(false);
  // The winback push, the check-in's "a practical next step" and the old
  // `/guided-journey` route land here with `more=1`: open "More for you",
  // where her path is. `n` makes a repeat visit open it again. The params
  // are consumed on this screen (as Support does with `ask`), so a later
  // remount of Today (another account signing in) does not open it again.
  const navigation = useNavigation();
  const { more: openMoreParam, n: openMoreNonce } = useLocalSearchParams<{ more?: string; n?: string }>();
  useEffect(() => {
    if (openMoreParam !== '1') return;
    setMoreVisited(true);
    setMoreOpen(true);
    if (moreY.current > 0) {
      scrollRef.current?.scrollTo({ y: Math.max(0, moreY.current - 8), animated: true });
    } else {
      scrollToMore.current = true;
    }
    navigation.setParams({ more: undefined, n: undefined } as never);
  }, [openMoreParam, openMoreNonce, navigation]);

  const firstName = user?.firstName?.trim() ?? '';
  const greeting = timeGreeting(t, firstName);
  const contextLabel = t(isAttached ? 'hero.contextAttached' : 'hero.contextDirect');
  const dailyQuote = t(`dailyQuote.${quoteIndex}`);
  async function completeCheckIn(input: CaregiverCheckInInput): Promise<void> {
    const nextStreak = await saveCheckIn(input);
    // Five days in a row, on a check-in that went all right: a hard day gets
    // the support it asked for, not an invitation (nothing is read to target
    // her; a difficult answer only keeps the card away).
    if (nextStreak.currentStreak === 5 && !isDifficultCheckIn(input)) setCheckinWeek(true);
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
        safety: { situationBand: situation.band },
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
  const weeklyOneThing: WeeklyOneThing | null = takeaway && !i18n.language.startsWith('es')
    ? { text: takeaway.body, fromCall: true }
    : curriculumPiece ? { text: curriculumPiece.practice, fromCall: false }
      : primaryDoor !== 'free_call' ? { text: t('situationCta.oneThingSupport'), fromCall: false } : null;
  // The free Monday call leads Today, right after immediate help: saving a
  // seat is the first thing a new member is asked to do.
  const mondayCallCard = (
    <SituationCard
      accountId={user?.id ?? null}
      nextFreeCall={nextFreeCall}
      primaryDoor={primaryDoor}
      weeklyOneThing={weeklyOneThing}
      onRsvp={rsvpFreeCall}
      onDecline={declineFreeCall}
      onSupportCallJoin={queueMondayMeetingReview}
      onSupportCallOpenFailed={() => cancelQueuedSupportCallReview(user?.id ?? null)}
      seatSavedHere={seatSavedHere}
    />
  );

  // The same header as every tab (title left, Settings right); Today's title
  // is her greeting. On every version of Today: free and member.
  const header = <TabHeader title={greeting} />;

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
    // (Never on a Monday the website cancelled.)
    && !nextFreeCall.rsvped && !nextFreeCall.declined && !isCancelledMeetingDate(nextFreeCall.cancelledDate);
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
  // show takes the slot (chooseNextStep); the rest wait under "More for you".
  // Each card still decides for itself whether it shows. Her path's step is
  // the last resort; outside the slot it stays tucked, since "Your path"
  // under "More for you" already shows it.
  const nextStepCards: Record<NextStepCard, React.ReactNode> = {
    willingnessWindow: willingnessWindowAlert,
    lovedOneCheck: lovedOneCheckCard,
    holidayPlan: holidayCard,
    invitation: invitationCard,
    pathStep: <PathNextStepCard stage={lovedOne?.stage} status={lovedOneStatus} loading={lovedOneLoading} />,
  };
  const nextStepItem = (card: NextStepCard, shown: boolean) => (
    <NextStepItem key={card} shown={shown} onShowing={(showing) => nextStep.report(card, showing)}>
      {nextStepCards[card]}
    </NextStepItem>
  );
  const onMoreLayout = (event: LayoutChangeEvent) => {
    moreY.current = event.nativeEvent.layout.y;
    if (!scrollToMore.current) return;
    scrollToMore.current = false;
    scrollRef.current?.scrollTo({ y: Math.max(0, moreY.current - 8), animated: true });
  };
  const moreSection = (key: string, children: React.ReactNode) => (
    <View key={key} style={{ display: moreOpen ? 'flex' : 'none' }}>
      {moreVisited && children}
    </View>
  );
  // Both lists go into one keyed list on the screen, so a card stays mounted
  // (and keeps what she typed) when it moves between the slot and "More".
  const nextStepSlot = nextStep.slot ? [nextStepItem(nextStep.slot, true)] : [];
  // ONE collapsed "More for you": her path first, then this week's other
  // steps, then what the tier adds (`rest`: this week's piece, boundary wins,
  // progress, signs to watch and, for a free member, membership last).
  const moreForYou = (rest: React.ReactNode) => [
    <View key="more" onLayout={onMoreLayout}>
      <TodayDisclosureToggle
        title={t('disclosure.more')}
        expanded={moreOpen}
        onPress={() => {
          setMoreVisited(true);
          setMoreOpen((open) => !open);
        }}
      />
    </View>,
    moreSection('path', pathwayCard),
    ...NEXT_STEP_PRIORITY.filter((card) => card !== nextStep.slot)
      .map((card) => nextStepItem(card, moreOpen && nextStep.more.includes(card))),
    moreSection('rest', rest),
  ];
  const curriculumCard = curriculumPiece ? (
    <CurriculumCard
      piece={curriculumPiece}
      week={curriculumWeek}
      phaseLabel={t(PHASE_LABEL_KEY[curriculumPhase])}
    />
  ) : null;
  const holdLogCard = (
    <HoldLogCard
      own={holdLog.own}
      shared={holdLog.shared}
      saving={holdLog.saving}
      canShare={!!familySpace}
      nameFor={(id) => familySpace?.members.find((m) => m.accountId === id)?.displayName ?? youLabel}
      onSave={(result, share) => { void saveBoundaryWin(result, share); }}
    />
  );
  // The Tracker is a pushed screen, not a tab: this row is its door from
  // Today. /tracker keeps its own membership gate for a free member.
  const signsToWatchRow = (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={t('moreForYou.signsTitle')}
      accessibilityHint={t('moreForYou.signsBody')}
      onPress={() => router.push('/tracker' as never)}
      activeOpacity={0.75}
      style={[styles.signsRow, { backgroundColor: colors.white, borderColor: colors.line }]}
    >
      <View style={styles.signsText}>
        <Text style={[styles.signsTitle, { color: colors.ink }]}>{t('moreForYou.signsTitle')}</Text>
        <Text style={[styles.signsBody, { color: colors.inkSoft }]}>{t('moreForYou.signsBody')}</Text>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={24} color={colors.primary} accessible={false} importantForAccessibility="no" />
    </TouchableOpacity>
  );

  // The Monday call and the daily check-in lead for every membership tier.
  // Today does one job: greeting (and, after time away, the welcome back),
  // the Monday meeting, the check-in, ONE next step and "What do you need
  // right now?" (the door for a bad day). Everything else waits in ONE
  // collapsed "More for you".
  if (!canAccessFullToday) {
    return (
      <ScreenContainer backgroundColor={colors.cream} scrollRef={scrollRef}>
        {header}
        {welcomeBackCard}
        {mondayCallCard}
        {reminderAskCard}
        {user && !i18n.language.startsWith('es') && <MondayReflection key={user.id} accountId={user.id} />}
        <View onLayout={onCheckInLayout}>
          {checkInCard}
          <CheckInFeedbackCard checkIn={todayCheckIn} />
          {/* Five days of check-ins: the same soft card, under the check-in. */}
          <ContextualMembershipInvitation
            accountId={user?.id ?? null}
            placement="checkin-week"
            completed={checkinWeek}
          />
        </View>
        {[...nextStepSlot, <NeedsRouter key="needs" />, ...moreForYou(
          <>
            {curriculumCard}
            {holdLogCard}
            <MoodChart accountId={user?.id ?? null} timezone={user?.timezone} />
            {signsToWatchRow}
            {/* An invitation, not a lock: the same card as the Support tab
                (what Essential adds, the store's price, "See plans"), last.
                Free members only (this branch). Its own row, so the store is
                asked for prices only when she opens it. */}
            <TodayDisclosure title={t('disclosure.membership')}>
              <ExploreMembership />
            </TodayDisclosure>
          </>,
        )]}
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer backgroundColor={colors.cream} scrollRef={scrollRef}>
      {header}
      {welcomeBackCard}
      {mondayCallCard}
      {reminderAskCard}
      {user && !i18n.language.startsWith('es') && <MondayReflection key={user.id} accountId={user.id} />}

      <View onLayout={onCheckInLayout}>
        {checkInCard}
        <CheckInFeedbackCard checkIn={todayCheckIn} />
      </View>
      {[...nextStepSlot, <NeedsRouter key="needs" />, ...moreForYou(
        <>
          {curriculumCard}
          {holdLogCard}
          <ContinueLetterCard accountId={user?.id ?? null} />
          <HeroCard
            dayCount={dayCount}
            contextLabel={contextLabel}
            quote={dailyQuote}
            checkInStreak={streak.currentStreak}
            boundariesHeld={boundariesHeld}
            groupSessions={groupSessions}
          />
          <WeekReviewCard accountId={user?.id ?? null} boundariesHeld={boundariesHeld} />
          <MoodChart accountId={user?.id ?? null} timezone={user?.timezone} />
          {signsToWatchRow}
        </>,
      )]}
      {isAdmin && (
        <TouchableOpacity accessibilityRole="button" onPress={() => router.push('/admin')} style={styles.adminLink}>
          <Text style={[styles.adminLinkText, { color: colors.inkSoft }]}>Admin</Text>
        </TouchableOpacity>
      )}
    </ScreenContainer>
  );
}

/**
 * Inside "Explore membership". Mounted only once she opens that section, so
 * the store is asked for prices then and not on every visit to Today; until
 * they arrive (or if they do not) the card shows no price, as on Support.
 */
function ExploreMembership() {
  const offers = usePlanOffers();
  return <PlansTeaserCard offers={offers} source="today_membership" />;
}

function timeGreeting(t: TFunction<'today'>, name: string): string {
  const h = new Date().getHours();
  const period = h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  // No name on file: a complete greeting, not an English placeholder name.
  return name ? t(`greeting.${period}`, { name }) : t(`greeting.${period}NoName`);
}

const styles = StyleSheet.create({
  // "Signs to watch": a full-width row, as tall as the text needs.
  signsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  signsText: { flex: 1 },
  signsTitle: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  signsBody: { fontSize: 13, lineHeight: 18, marginTop: 2 },
  adminLink: { alignSelf: 'center', marginTop: 32, paddingVertical: 8, paddingHorizontal: 16 },
  adminLinkText: { fontSize: 12 },
});
