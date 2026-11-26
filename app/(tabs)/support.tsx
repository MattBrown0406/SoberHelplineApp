import { useToolOpened } from '../../src/hooks/useToolOpened';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Linking,
  StyleSheet,
  ActivityIndicator,
  AccessibilityInfo,
} from 'react-native';
import { supabase } from '../../src/lib/supabase';
import { appAlert } from '../../src/lib/appAlert';
import { ScreenContainer } from '../../src/components/ui/ScreenContainer';
import { TabHeader } from '../../src/components/ui/TabHeader';
import { buttonShape } from '../../src/components/ui/Button';
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAccount } from '../../src/contexts/AccountContext';
import { useTheme } from '../../src/contexts/ThemeContext';
import { PRIMARY_ON_CALL } from '../../src/content/onCall';
import { useSessions, type DbSession } from '../../src/hooks/useSessions';
import { usePrivateVideoSessions } from '../../src/hooks/usePrivateVideoSessions';
import { PremierVideoSchedulingCard } from '../../src/components/video/PremierVideoSchedulingCard';
import { withAppContext } from '../../src/lib/websiteLinks';
import { useCoachingRate } from '../../src/hooks/useCoachingRate';
import { useSessionSchedule } from '../../src/hooks/useSessionSchedule';
import { LA_SOBREMESA_CALL_LENGTH_MS, isFamilySquaresSession, isLaSobremesaSession, sessionDisplayTitle } from '../../src/lib/familySquaresSchedule';
import { clearFamilySquaresJoin, markFamilySquaresJoin } from '../../src/lib/meetingAttendance';
import { FamilySquaresSeatPanel } from '../../src/components/familySquares/FamilySquaresSeatPanel';
import { FamilySquaresFirstTimerNote } from '../../src/components/familySquares/FamilySquaresFirstTimerNote';
import { FamilySquaresSpotSavedLine } from '../../src/components/familySquares/FamilySquaresSpotSavedLine';
import { usePlanOffers } from '../../src/hooks/usePlanPurchase';
import { PlansTeaserCard } from '../../src/components/plans/PlansTeaserCard';
import { useSituation } from '../../src/hooks/useSituation';
import { funnelDoor } from '../../src/lib/situation';
import { logFunnelEventAndWait } from '../../src/lib/funnel';
import { callCardView, seatSaveFailureKey, sessionJoinWindow } from '../../src/lib/familySquaresCard';
import { isCancelledMeetingDate, isFamilySquaresKnownCancelled } from '../../src/lib/familySquaresCancelled';
import { TodayDisclosure } from '../../src/components/today/TodayDisclosure';
import { PassItOnCard } from '../../src/components/today/PassItOnCard';
import { CrisisSheet } from '../../src/components/support/CrisisSheet';
import { ProviderSheet } from '../../src/components/support/ProviderSheet';
import { QuestionSheet } from '../../src/components/support/QuestionSheet';
import { TeamCard } from '../../src/components/support/TeamCard';
import { SupportGroupsCard } from '../../src/components/support/SupportGroupsCard';
import { MemberPlanCard } from '../../src/components/support/MemberPlanCard';
import { MembershipGuideCard } from '../../src/components/support/MembershipGuideCard';
import { supportCard, supportEyebrow } from '../../src/components/support/cardStyle';

// The Support tab, top to bottom:
//   1. the header;
//   2. crisis help: one row that opens the crisis sheet (911, 988, Crisis
//      Copilot, the on-call coach, the crisis guide, the helpline);
//   3. Family Squares (La Sobremesa in Spanish): the meeting, with Save and Join;
//   4. coaching with Matt: messages, private video, booking, an attached family's team;
//   5. membership: her plan and how to use it, or the plans card;
//   6. "More support", closed: treatment finder, a provider, groups, Pass it on.

function sessionTypeKey(kind: DbSession['kind'], t: (k: string) => string): string {
  if (kind === 'group') return t('sessions.typeGroup');
  if (kind === 'one-on-one') return t('sessions.typeOneOnOne');
  return t('sessions.typeFamily');
}

/** A heading over a group of cards (read as a heading by VoiceOver). */
function SectionHeading({ title }: { title: string }) {
  const { colors } = useTheme();
  return <Text accessibilityRole="header" style={[styles.sectionHeading, { color: colors.inkSoft }]}>{title}</Text>;
}

export default function SupportScreen() {
  useToolOpened('support');
  const { colors } = useTheme();
  const { user, isAttached, accountState, entitlements } = useAccount();
  // A session-reminder push carries the RSVP'd session id so the card it is about stands out.
  // soberhelpline.com/app/family-squares opens Support with focus=family-squares.
  // ask=question (the hour-before reminder) opens that session's question sheet.
  const { sessionId: sessionIdParam, focus, ask } = useLocalSearchParams<{ sessionId?: string; focus?: string; ask?: string }>();
  const { t } = useTranslation('support');
  const router = useRouter();
  // Prices and trial eligibility for the plans card. Buying happens on the
  // plans screen (app/plans.tsx); this tab only opens it.
  const planOffers = usePlanOffers();
  const { subscriptionPrices, retryPrices } = planOffers;
  const { t: tPlans } = useTranslation('plans');
  const coachingRate = useCoachingRate();
  const scheduleFor = useSessionSchedule();

  const [crisisOpen, setCrisisOpen] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [questionSession, setQuestionSession] = useState<DbSession | null>(null);
  const [questionText, setQuestionText] = useState('');
  const [questionSubmitting, setQuestionSubmitting] = useState(false);
  const [questionSubmitted, setQuestionSubmitted] = useState(false);
  // 'sent': the question reads like an emergency — 911/988 stay on screen
  // until she closes it. 'unsent': it could not be sent; retry, with 911/988.
  const [questionCrisis, setQuestionCrisis] = useState<'sent' | 'unsent' | null>(null);
  // A reply that lands after the sheet was closed belongs to no sheet.
  const questionSheetGeneration = useRef(0);

  function closeQuestionSheet() {
    // Orphans any send still in flight; the next sheet starts ready to send.
    questionSheetGeneration.current += 1;
    setQuestionSession(null);
    setQuestionText('');
    setQuestionSubmitting(false);
    setQuestionSubmitted(false);
    setQuestionCrisis(null);
  }

  async function submitQuestion() {
    if (!questionText.trim() || !questionSession || !user?.id) return;
    const generation = questionSheetGeneration.current;
    const current = () => generation === questionSheetGeneration.current;
    const text = questionText.trim();
    const row = { account_id: user.id, session_id: questionSession.id, question: text };
    setQuestionSubmitting(true);
    try {
      let { data, error } = await supabase.from('session_questions').insert(row).select('crisis_tier').single();
      // A backend without the screen's column yet (42703 / PGRST204): plain insert.
      if (error && (error.code === '42703' || error.code === 'PGRST204')) {
        ({ data, error } = await supabase.from('session_questions').insert(row).select('id').single());
      }
      if (!current()) return;
      if (error) throw error;
      setQuestionSubmitted(true);
      setQuestionCrisis(null);
      // The server reads every question with the community crisis screen and
      // alerts an admin; she sees emergency help now rather than on Monday.
      if ((data as { crisis_tier?: string | null } | null)?.crisis_tier) {
        setQuestionCrisis('sent');
        AccessibilityInfo.announceForAccessibility(t('questionModal.crisisNote'));
        return;
      }
      setTimeout(() => { if (current()) closeQuestionSheet(); }, 1500);
    } catch {
      if (!current()) return;
      // Unsent, so nothing screened it and no admin heard about it: the sheet
      // keeps her words for a retry, with 911/988 on screen in case it is an
      // emergency (never a dead end behind an error alert).
      setQuestionCrisis('unsent');
      AccessibilityInfo.announceForAccessibility(t('questionModal.crisisNotSent'));
    } finally {
      if (current()) setQuestionSubmitting(false);
    }
  }

  const { situation } = useSituation(user?.id ?? null);
  const crisisDoor = funnelDoor(situation);

  const { sessions, loading: sessionsLoading, toggleRsvp, declineRsvp, seatSavedHere } = useSessions(user?.id ?? null);
  const focusedSessionId = sessionIdParam
    ?? (focus === 'family-squares'
      ? sessions.find((s) => isFamilySquaresSession(s) || isLaSobremesaSession(s))?.id
      : undefined);
  // Opened from the hour-before reminder (or Today's "Send a question"):
  // consume the param on this screen (router.setParams acts on whatever screen
  // is in front), then open the sheet once Support is in view and the session
  // has loaded. Her seat is not re-checked: Support's copy of the sessions can
  // be older than the seat she just saved on Today, and only seat holders are
  // sent here.
  const navigation = useNavigation();
  const [pendingAsk, setPendingAsk] = useState<string | null>(null);
  const [supportFocused, setSupportFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setSupportFocused(true);
    return () => {
      setSupportFocused(false);
      setPendingAsk(null);
    };
  }, []));
  useEffect(() => {
    if (ask !== 'question') return;
    navigation.setParams({ ask: undefined } as never);
    setPendingAsk(sessionIdParam ?? null);
  }, [ask, sessionIdParam, navigation]);
  useEffect(() => {
    if (!pendingAsk || !supportFocused) return;
    const session = sessions.find((s) => s.id === pendingAsk);
    if (!session) return;
    setPendingAsk(null);
    // (No question for a Monday the website cancelled.)
    if (!isLaSobremesaSession(session) && !isCancelledMeetingDate(session.cancelledDate)) setQuestionSession(session);
  }, [pendingAsk, supportFocused, sessions]);
  // Goes up when a Save tap on this screen has just saved her La Sobremesa
  // seat, so the confirmation is read out as Family Squares' is (useSessions
  // counts only Family Squares seats).
  const [sobremesaSavedHere, setSobremesaSavedHere] = useState(0);
  const handleSessionRsvp = async (session: DbSession) => {
    const wasSaved = !!session.rsvped;
    const saved = await toggleRsvp(session);
    if (saved === true && !wasSaved && isLaSobremesaSession(session)) setSobremesaSavedHere((count) => count + 1);
    if (saved === 'not_available') appAlert(t('sessions.rsvpErrorTitle'), t('common:laSobremesa.notAvailable'));
    // The website refused (a cancelled week, or it will not register her):
    // not a connection problem, so the message says what is true. When the
    // website said why, its word decides (familySquaresCard).
    else if (saved === 'website_declined' || saved === 'meeting_cancelled' || saved === 'registration_unavailable') {
      const knownCancelled = isCancelledMeetingDate(session.cancelledDate) || isFamilySquaresKnownCancelled();
      appAlert(t('sessions.rsvpErrorTitle'), t(seatSaveFailureKey('website_declined', knownCancelled, saved === 'website_declined' ? undefined : saved)));
    } else if (!saved) appAlert(t('sessions.rsvpErrorTitle'), t('sessions.rsvpErrorBody'));
  };
  const joining = useRef(false);
  const joinSession = async (session: DbSession) => {
    if (!session.zoom_url) return;
    // One Join at a time: a second tap while this one is on its way does nothing.
    if (joining.current) return;
    joining.current = true;
    try {
      const url = withAppContext(session.zoom_url);
      const familySquares = isFamilySquaresSession(session);
      // Noted before Zoom opens, so coming back ten minutes later can count as attending.
      if (familySquares) await markFamilySquaresJoin(user?.id, 'support');
      // Sent before Zoom opens too: once the app is in the background the
      // request may never leave. Waits a moment at most (funnel), as Today's
      // Join and the reminder tap do.
      if (session.kind === 'group') await logFunnelEventAndWait('attended', { source: 'support' });
      try {
        await Linking.openURL(url);
      } catch {
        if (familySquares) await clearFamilySquaresJoin(user?.id);
      }
    } finally {
      joining.current = false;
    }
  };
  // One session row, used by every list on this screen. Family Squares shows
  // under its one name and, once her seat is saved, offers every Monday, the
  // calendar file and "can't make it this week". `last`: no rule under the
  // last row of a card.
  const renderSession = (sess: DbSession, showType: boolean, last: boolean) => {
    const name = sessionDisplayTitle(sess, t);
    const familySquares = isFamilySquaresSession(sess);
    const laSobremesa = isLaSobremesaSession(sess);
    // The Monday meetings (Family Squares, La Sobremesa) use Today's words: "Save my spot".
    const mondayMeeting = familySquares || isLaSobremesaSession(sess);
    // What a Family Squares row offers is decided in one place
    // (familySquaresCard). A Monday the website cancelled offers nothing for
    // that date: only a calm line, and the "every Monday" switch. The
    // cancelled date is compared with the coming meeting's date on every draw:
    // an answer read for last Monday never hides this Monday's meeting.
    const view = callCardView({
      familySquares,
      cancelled: isCancelledMeetingDate(sess.cancelledDate),
      answer: sess.rsvped ? 'going' : sess.declined ? 'declined' : 'none',
      hasLink: !!sess.zoom_url,
      joinWindow: sessionJoinWindow(sess.next_at, new Date(), isLaSobremesaSession(sess) ? LA_SOBREMESA_CALL_LENGTH_MS : undefined),
    });
    // Join and Save each do what they always did. Which one is the big button
    // is decided in familySquaresCard, as on Today: Save until the meeting is
    // near, Join from three hours before it starts. The other is a small link.
    const joinLeads = view.join && view.joinProminence === 'main';
    const saveLeads = view.saveSpot && view.saveProminence === 'main';
    const joinButton = view.join && (
      <TouchableOpacity
        key="join"
        accessibilityRole="button"
        accessibilityLabel={t('sessions.joinLabel', { name })}
        style={joinLeads ? [styles.solidBtn, { backgroundColor: colors.primary }] : styles.sessionQuietLink}
        activeOpacity={0.8}
        onPress={() => void joinSession(sess)}
      >
        <Text style={joinLeads ? styles.solidBtnText : [styles.sessionQuietLinkText, { color: colors.primary }]}>{t('sessions.joinZoom')}</Text>
      </TouchableOpacity>
    );
    const saveButton = view.saveSpot && (
      <TouchableOpacity
        key="save"
        accessibilityRole="button"
        accessibilityLabel={t(mondayMeeting ? 'today:situationCta.rsvpLabel' : 'sessions.rsvpLabel', { name })}
        style={saveLeads ? [styles.solidBtn, { backgroundColor: colors.primary }] : styles.sessionQuietLink}
        activeOpacity={0.8}
        onPress={() => void handleSessionRsvp(sess)}
      >
        <Text style={saveLeads ? styles.solidBtnText : [styles.sessionQuietLinkText, { color: colors.primary }]}>
          {t(mondayMeeting ? 'today:situationCta.rsvp' : 'sessions.rsvpButton')}
        </Text>
      </TouchableOpacity>
    );
    return (
      <View key={sess.id} style={[styles.sessionOuter, !last && { borderBottomWidth: 1, borderBottomColor: colors.line }, sess.id === focusedSessionId && { backgroundColor: colors.primaryLight }]}>
        <Text style={[styles.sessionTitle, { color: colors.ink }]}>{name}</Text>
        <Text style={[styles.sessionMeta, { color: colors.inkSoft }]}>
          {showType ? `${sessionTypeKey(sess.kind, t)} · ${scheduleFor(sess)}` : scheduleFor(sess)}
        </Text>
        {!view.cancelledLine && (
          <View style={styles.sessionActions}>
            {/* The one confirmation: "Your spot is saved for Monday, November 16". A call
                other than Family Squares keeps the tap its "Confirmed" button had
                (Family Squares has "Can't make it this week" below). A seat saved
                here is read out, La Sobremesa's as Family Squares'. */}
            <FamilySquaresSpotSavedLine
              confirmed={view.confirmed}
              session={sess}
              savedHere={familySquares ? seatSavedHere : laSobremesa ? sobremesaSavedHere : 0}
              showDate={familySquares}
              onPress={familySquares ? undefined : () => void handleSessionRsvp(sess)}
              pressLabel={t('sessions.confirmLabel', { name })}
            />
            {joinLeads ? joinButton : saveLeads ? saveButton : null}
            <View style={styles.sessionQuietRow}>
              {!joinLeads && joinButton}
              {!saveLeads && saveButton}
            </View>
          </View>
        )}
        {view.cancelledLine && (
          <Text style={[styles.cancelledLine, { color: colors.ink }]} accessibilityLiveRegion="polite">
            {t('common:familySquares.cancelled.line')}
          </Text>
        )}
        {sess.rsvped && !view.cancelledLine && !isLaSobremesaSession(sess) && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('questionModal.buttonLabel', { name })}
            style={[styles.questionBtn, { borderColor: colors.primary }]}
            activeOpacity={0.8}
            onPress={() => setQuestionSession(sess)}
          >
            <Text style={[styles.questionBtnText, { color: colors.primary }]}>
              {t('questionModal.button')}
            </Text>
          </TouchableOpacity>
        )}
        {view.rsvpNote ? (
          <Text style={[styles.rsvpNote, { color: colors.inkSoft }]}>{t('common:familySquares.rsvpNote')}</Text>
        ) : isLaSobremesaSession(sess) ? (
          <Text style={[styles.rsvpNote, { color: colors.inkSoft }]}>{t('common:laSobremesa.note')}</Text>
        ) : null}
        {/* The first-timer note here is the RSVP confirmation; Today's card shows it before too. */}
        {view.firstTimerNote && sess.rsvped && <FamilySquaresFirstTimerNote accountId={user?.id ?? null} />}
        {familySquares && (
          <FamilySquaresSeatPanel
            accountId={user?.id ?? null}
            rsvp={sess.rsvped ? 'going' : sess.declined ? 'declined' : 'none'}
            onDecline={() => declineRsvp(sess)}
            reminderAsk
            seatSavedHere={seatSavedHere}
            cancelled={view.cancelledLine}
          />
        )}
      </View>
    );
  };
  // While the list is still loading (or could not be read), the card still
  // names the meeting instead of showing an empty title.
  const meetingPlaceholder = (
    <View style={styles.sessionOuter} accessibilityState={{ busy: sessionsLoading }}>
      <Text style={[styles.sessionTitle, { color: colors.ink }]}>{t('mondayGroup.loadingTitle')}</Text>
      {sessionsLoading && <ActivityIndicator style={styles.sessionLoading} color={colors.primary} />}
    </View>
  );
  const canAccessPrivateVideo = !!user && entitlements.canAccessPrivateVideo;
  const hasMembershipAccess = entitlements.canAccessGroups;
  const freeTier = !isAttached && !hasMembershipAccess;
  // Members off the Text Line plan can still read Matt's replies to their
  // situation briefs; give them a lasting way back to them.
  const [hasCoachReplies, setHasCoachReplies] = useState(false);
  useEffect(() => {
    if (!user || hasMembershipAccess) {
      setHasCoachReplies(false);
      return;
    }
    let active = true;
    void supabase
      .from('messages')
      .select('id, threads!inner(kind)', { count: 'exact', head: true })
      .eq('sender_role', 'coach')
      .eq('threads.kind', 'oncall')
      .then(({ count }) => {
        if (active) setHasCoachReplies((count ?? 0) > 0);
      });
    return () => { active = false; };
  }, [user?.id, hasMembershipAccess]);
  const privateVideo = usePrivateVideoSessions(user?.id ?? null, canAccessPrivateVideo);
  const groupSessions = sessions.filter((s) => s.kind === 'group');

  return (
    <ScreenContainer backgroundColor={colors.cream}>
      <CrisisSheet
        visible={crisisOpen}
        onClose={() => setCrisisOpen(false)}
        isAttached={isAttached}
        canMessage={entitlements.canMessageOnCallCoach}
        onMessage={() => router.push('/chat')}
        onCopilot={() => router.push('/crisis-mode')}
        door={crisisDoor}
      />
      <ProviderSheet visible={providerOpen} onClose={() => setProviderOpen(false)} />
      <QuestionSheet
        visible={questionSession !== null}
        questionText={questionText}
        onChangeText={setQuestionText}
        questionSubmitting={questionSubmitting}
        questionSubmitted={questionSubmitted}
        questionCrisis={questionCrisis}
        onSubmit={() => void submitQuestion()}
        onClose={closeQuestionSheet}
      />

        {/* 1. Header: the same one as every tab, with the same Settings button. */}
        <TabHeader title={t('header')} />

        <Text style={[styles.referralBody, styles.sectionNote, { color: colors.inkSoft }]}>{t('intro')}</Text>

        {/* 2. Crisis help — always visible, one tap, before anything that
            depends on her account. The sheet holds 911, 988, Crisis Copilot,
            the on-call coach, the crisis guide and the helpline. */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('crisis.button')}
          accessibilityHint={t('crisis.buttonHint')}
          style={[styles.sosButton, { backgroundColor: colors.coral }]}
          onPress={() => setCrisisOpen(true)}
          activeOpacity={0.85}
        >
          <Text style={styles.sosText}>🆘  {t('crisis.button')}</Text>
        </TouchableOpacity>

        {/* 3. Family Squares (La Sobremesa in Spanish): the main thing people come here for. */}
        {freeTier ? (
          <View style={[styles.card, { borderColor: colors.line }]}>
            <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
              {t('mondayGroup.eyebrow')}
            </Text>
            {/* The meeting's name is the row's own title below: one heading, not two. */}
            <Text style={[styles.referralBody, { color: colors.inkSoft }]}>
              {t('mondayGroup.sub')}
            </Text>
            {groupSessions.length === 0 && meetingPlaceholder}
            {groupSessions.map((sess, index, list) => renderSession(sess, false, index === list.length - 1))}
          </View>
        ) : (
          // Members and attached families: every upcoming session, Family Squares among them.
          <View style={[styles.card, { borderColor: colors.line }]}>
            <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
              {t('sessions.eyebrow')}
            </Text>
            {sessions.length === 0 && meetingPlaceholder}
            {sessions.map((sess, index, list) => renderSession(sess, true, index === list.length - 1))}
          </View>
        )}

        {/* 4. Coaching with Matt. */}
        <SectionHeading title={t('coachingHeading', { name: PRIMARY_ON_CALL.firstName })} />
        <Text style={[styles.referralBody, styles.sectionNote, { color: colors.inkSoft }]}>{t('peopleAccess', { rate: coachingRate.hourly })}</Text>

        {freeTier && hasCoachReplies ? (
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.card, { borderColor: colors.primary, backgroundColor: colors.primaryLight }]}
            onPress={() => router.push('/chat')}
            activeOpacity={0.85}
          >
            <Text style={[styles.referralTitle, { color: colors.ink }]}>{t('coachReplies.title')}</Text>
            <Text style={[styles.referralBody, { color: colors.inkSoft }]}>{t('coachReplies.body')}</Text>
          </TouchableOpacity>
        ) : null}

        {/* Entitled member actions stay ahead of membership explanations. */}
        {hasMembershipAccess && (
          <View style={[styles.card, { borderColor: colors.line }]}>
            <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
              {t('messages.eyebrow')}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.outlineBtn, { borderColor: colors.primary, marginTop: 0 }]}
              activeOpacity={0.8}
              onPress={() => router.push('/chat')}
            >
              <Text style={[styles.outlineBtnText, { color: colors.primary }]}>
                {t('chat.openButton')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {hasMembershipAccess && canAccessPrivateVideo ? (
          <View style={[styles.card, { borderColor: colors.line }]}>
            <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>{t('privateVideo.eyebrow').toUpperCase()}</Text>
            <Text style={[styles.referralTitle, { color: colors.ink }]}>{t('privateVideo.title')}</Text>
            <Text style={[styles.referralBody, { color: colors.inkSoft }]}>{t('privateVideo.body')}</Text>
            <PremierVideoSchedulingCard
              controller={privateVideo}
              t={t}
              translationRoot="privateVideo.scheduling"
              onJoin={(session) => router.push({ pathname: '/video-session' as never, params: { sessionId: session.id, room: session.room_name } })}
            />
          </View>
        ) : null}

        {/* Attached: their team. */}
        {isAttached && <TeamCard />}

        {/* Booking a private session: members (not attached families), as before 4.4. */}
        {!isAttached && hasMembershipAccess && (
          <View style={[styles.card, { borderColor: colors.line }]}>
            <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
              {t('coaching.eyebrow')}
            </Text>
            <Text style={[styles.referralTitle, { color: colors.ink }]}>
              {t('coaching.cardTitle')}
            </Text>
            <Text style={[styles.referralBody, { color: colors.inkSoft }]}>
              {t('coaching.cardBody', { rate: coachingRate.hourly })}
            </Text>
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.outlineBtn, { borderColor: colors.primary, marginTop: 12 }]}
              activeOpacity={0.8}
              onPress={() => router.push('/book-coaching')}
            >
              <Text style={[styles.outlineBtnText, { color: colors.primary }]}>
                {t('coaching.cardButton')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Without a plan, the one link that explains coaching stays (the only
            way to that screen). */}
        {!hasMembershipAccess && (
          <TouchableOpacity accessibilityRole="button" style={[styles.outlineBtn, { borderColor: colors.primary, marginTop: 0, marginBottom: 12 }]} onPress={() => router.push('/membership-guide')}><Text style={[styles.outlineBtnText, { color: colors.primary }]}>{t('coachingGuideLink')}</Text></TouchableOpacity>
        )}

        {/* 5. Membership. */}
        {/* (A heading only for someone with a membership: no new promotion for anyone else.) */}
        {(hasMembershipAccess || isAttached) && <SectionHeading title={t('membership.eyebrow')} />}

        {/* Members: one unambiguous current plan; upgrade and review are explicit actions. */}
        {!isAttached && hasMembershipAccess && <MemberPlanCard accountState={accountState} />}

        {/* "How to use your membership" is for someone who has one. */}
        {hasMembershipAccess && <MembershipGuideCard isAttached={isAttached} offers={planOffers} />}

        {isAttached && (
          <View style={[styles.card, { borderColor: colors.line }]}>
            <View style={styles.membershipRow}>
              <View style={[styles.coveredChip, { backgroundColor: colors.greenLight }]}>
                <Text style={[styles.coveredText, { color: colors.green }]}>
                  {t('membership.covered')}
                </Text>
              </View>
              <Text style={[styles.membershipSub, { color: colors.inkSoft }]}>
                {t('membership.coveredSub')}
              </Text>
            </View>
          </View>
        )}

        {/* The free conversation practice stays one tap away without a plan. */}
        {!hasMembershipAccess && (
          <TouchableOpacity accessibilityRole="button" style={[styles.outlineBtn, { borderColor: colors.primary, marginTop: 0, marginBottom: 12 }]} onPress={() => router.push('/free-practice')}><Text style={[styles.outlineBtnText, { color: colors.primary }]}>{t('freePracticeLink')}</Text></TouchableOpacity>
        )}

        {freeTier && (
          <>
            {/* The plans in short; the plans screen has all of it and is where a plan is bought. */}
            <PlansTeaserCard offers={planOffers} source="support_tab" />
            {/* The card says "Store price unavailable" when the store did not
                answer: one tap reads the prices again, as on the plans card. */}
            {!subscriptionPrices.essential && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={tPlans('retryPricesLabel')}
                style={[styles.outlineBtn, { borderColor: colors.primary, marginTop: 0, marginBottom: 12 }]}
                onPress={retryPrices}
              >
                <Text style={[styles.outlineBtnText, { color: colors.primary }]}>{tPlans('retryPrices')}</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {/* 6. More support, closed until she opens it. */}
        <View style={styles.moreSupport}>
          <TodayDisclosure title={t('moreSupport.title')}>
            {/* Treatment Finder — all account types */}
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.85}
              onPress={() => router.push('/finder')}
              style={[styles.finderCard, { backgroundColor: colors.primary }]}
            >
              <Text style={styles.finderTitle}>{t('finderCard.title')}</Text>
              <Text style={styles.finderSub}>{t('finderCard.sub')}</Text>
            </TouchableOpacity>

            {/* A vetted interventionist (members). */}
            {!isAttached && hasMembershipAccess && (
              <View style={[styles.card, { borderColor: colors.line }]}>
                <Text style={[styles.eyebrow, { color: colors.inkSoft }]}>
                  {t('referral.eyebrow')}
                </Text>
                <Text style={[styles.referralTitle, { color: colors.ink }]}>
                  {t('referral.title')}
                </Text>
                <Text style={[styles.referralBody, { color: colors.inkSoft }]}>
                  {t('referral.body')}
                </Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={[styles.outlineBtn, { borderColor: colors.primary, marginTop: 12 }]}
                  activeOpacity={0.8}
                  onPress={() => setProviderOpen(true)}
                >
                  <Text style={[styles.outlineBtnText, { color: colors.primary }]}>
                    {t('referral.button')}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Groups — every account type; the family forum for members. */}
            <SupportGroupsCard hasMembershipAccess={hasMembershipAccess} />

            {/* "Pass it on" (it left Today): public resources only. */}
            <PassItOnCard />
          </TodayDisclosure>
        </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  sosButton: {
    ...buttonShape,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  sosText: { color: '#fff', fontSize: 16, fontWeight: '700', textAlign: 'center' },

  card: supportCard,
  eyebrow: supportEyebrow,
  sectionHeading: { ...supportEyebrow, marginTop: 10, marginBottom: 8 },

  sessionOuter: {
    paddingVertical: 10,
  },
  sessionTitle: { fontSize: 15, fontWeight: '700' },
  sessionMeta: { fontSize: 12.5, marginTop: 2 },
  sessionLoading: { alignSelf: 'flex-start', marginTop: 10 },
  sessionActions: { marginTop: 10, gap: 6 },
  sessionQuietRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 22 },
  sessionQuietLink: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  sessionQuietLinkText: { fontSize: 13.5, fontWeight: '700', textAlign: 'center' },
  questionBtn: { minHeight: 44, justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 5,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  questionBtnText: { fontSize: 12, fontWeight: '600' },
  rsvpNote: { fontSize: 11.5, lineHeight: 16, marginTop: 8 },
  cancelledLine: { fontSize: 13.5, lineHeight: 19, marginTop: 8 },

  membershipRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  coveredChip: {
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  coveredText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  membershipSub: { fontSize: 12, flex: 1 },

  referralTitle: { fontSize: 15, fontWeight: '700', marginBottom: 6 },
  referralBody: { fontSize: 13, lineHeight: 19 },
  // A paragraph that stands between cards keeps the cards' own spacing below it.
  sectionNote: { marginBottom: 12 },

  // Every full-width button here is the app's one pill (buttonShape).
  solidBtn: {
    ...buttonShape,
    paddingVertical: 12,
    marginTop: 4,
  },
  solidBtnText: { color: '#fff', fontWeight: '700', fontSize: 14, lineHeight: 20, textAlign: 'center', flexShrink: 1 },
  outlineBtn: {
    ...buttonShape,
    borderWidth: 1.5,
    paddingVertical: 10,
    marginTop: 8,
  },
  outlineBtnText: { fontWeight: '700', fontSize: 14, lineHeight: 20, textAlign: 'center', flexShrink: 1 },

  moreSupport: { marginTop: 4 },
  finderCard: { borderRadius: 16, padding: 18, marginBottom: 12 },
  finderTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 4 },
  finderSub: { color: '#c9d6e6', fontSize: 13.5, lineHeight: 19 },
});
