import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { DOOR_COPY_KEY, DOOR_ROUTE, type FunnelDoor } from '../../lib/situation';
import { logFunnelEvent, logFunnelEventAndWait } from '../../lib/funnel';
import type { FreeCall } from '../../hooks/useTodayFeed';
import { useCoachingRate } from '../../hooks/useCoachingRate';
import { useSessionSchedule } from '../../hooks/useSessionSchedule';
import { isFamilySquaresSession, isLaSobremesaSession, sessionDisplayTitle } from '../../lib/familySquaresSchedule';
import { withAppContext } from '../../lib/websiteLinks';
import { clearFamilySquaresJoin, markFamilySquaresJoin } from '../../lib/meetingAttendance';
import { FamilySquaresSeatPanel } from '../familySquares/FamilySquaresSeatPanel';
import { FamilySquaresFirstTimerNote } from '../familySquares/FamilySquaresFirstTimerNote';
import { callCardView } from '../../lib/familySquaresCard';
import { isCancelledMeetingDate } from '../../lib/familySquaresCancelled';

/** This week's one thing: Matt's line from the call, else her own week's practice. */
export interface WeeklyOneThing {
  text: string;
  fromCall: boolean;
}

interface Props {
  /** Whose seat preferences and first-timer note this card shows. */
  accountId?: string | null;
  nextFreeCall: FreeCall | null;
  primaryDoor: FunnelDoor;
  weeklyOneThing?: WeeklyOneThing | null;
  onRsvp: () => void;
  /** "Can't make it this week" for Family Squares; answers false when it was not saved. */
  onDecline?: () => Promise<boolean>;
  onSupportCallJoin?: () => Promise<void>;
  onSupportCallOpenFailed?: () => Promise<void>;
  /** False on the bereaved Today: a saved seat is never followed by a reminder ask there. */
  seatReminderAsk?: boolean;
  /** Goes up when a Save tap on Today has just saved her seat (useTodayFeed): the reminder ask follows only that. */
  seatSavedHere?: number;
}

/**
 * Today's lead card, first on the screen after immediate help. The free
 * Monday call is the daily anchor (saving a seat is the first thing a new
 * member is asked to do), with this week's one thing from it; below, when
 * the family's situation warrants it, a higher-intent door (coaching or
 * intervention) is offered. The free call is never gated — it's the entry rung.
 */
export function SituationCard({ accountId = null, nextFreeCall, primaryDoor, weeklyOneThing, onRsvp, onDecline, onSupportCallJoin, onSupportCallOpenFailed, seatReminderAsk = true, seatSavedHere = 0 }: Props) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('today');
  const router = useRouter();
  const coachingRate = useCoachingRate();
  const scheduleFor = useSessionSchedule();

  // Family Squares is shown under its one name, not the database row's title.
  const title = nextFreeCall ? sessionDisplayTitle(nextFreeCall, t) : t('situationCta.freeCallTitle');
  // Family Squares shows its real next start in the member's time zone.
  const schedule = nextFreeCall
    ? scheduleFor(nextFreeCall)
    : t(i18n.language.startsWith('es') ? 'common:laSobremesa.scheduleFallback' : 'common:familySquares.scheduleFallback');
  const isFamilySquares = isFamilySquaresSession(nextFreeCall);
  // What the card offers is decided in one place (familySquaresCard). A Monday
  // the website cancelled offers nothing for that date: only a calm line.
  // The cancelled date is compared with the coming meeting's date on every
  // draw: an answer read for last Monday never hides this Monday's meeting.
  const view = callCardView({
    familySquares: isFamilySquares,
    cancelled: isCancelledMeetingDate(nextFreeCall?.cancelledDate),
    answer: nextFreeCall?.rsvped ? 'going' : nextFreeCall?.declined ? 'declined' : 'none',
    hasLink: !!nextFreeCall?.zoom_url,
  });
  // Anyone can join once the admin has set the link — RSVP is encouraged for
  // headcount but never a gate ("push of a button", no link required).
  const canJoin = view.join;
  const doorRoute = DOOR_ROUTE[primaryDoor];
  const joining = useRef(false);

  return (
    <View style={[styles.card, { backgroundColor: colors.white, borderColor: colors.line }]}>
      <Text style={[styles.eyebrow, { color: colors.primary }]}>{t('situationCta.eyebrow')}</Text>
      <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
      <Text style={[styles.schedule, { color: colors.inkSoft }]}>{schedule}</Text>

      {view.cancelledLine ? (
        <Text style={[styles.cancelledLine, { color: colors.ink }]} accessibilityLiveRegion="polite">
          {t('common:familySquares.cancelled.line')}
        </Text>
      ) : canJoin ? (
        <>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('situationCta.joinLabel', { name: title })}
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={() => void (async () => {
              // One Join at a time: a second tap while this one is on its way does nothing.
              if (joining.current) return;
              joining.current = true;
              try {
                try {
                  await onSupportCallJoin?.();
                } catch {
                  // Review instrumentation must never block access to the meeting.
                }
                // Noted before Zoom opens, so coming back ten minutes later can count as attending.
                if (isFamilySquares) await markFamilySquaresJoin(accountId, 'today');
                // Sent before Zoom opens too: once the app is in the background the
                // request may never leave. Waits a moment at most (funnel).
                await logFunnelEventAndWait('attended', { source: 'today' });
                try {
                  await Linking.openURL(withAppContext(nextFreeCall!.zoom_url!));
                } catch {
                  if (isFamilySquares) await clearFamilySquaresJoin(accountId);
                  await onSupportCallOpenFailed?.();
                }
              } finally {
                joining.current = false;
              }
            })()}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>{t('situationCta.join')}</Text>
          </TouchableOpacity>
          {view.saveSpot && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('situationCta.rsvpLabel', { name: title })}
              onPress={onRsvp}
              activeOpacity={0.75}
              style={styles.rsvpLink}
            >
              <Text style={[styles.rsvpLinkText, { color: colors.primary }]}>
                {t('situationCta.rsvp')}
              </Text>
            </TouchableOpacity>
          )}
        </>
      ) : (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t(nextFreeCall?.rsvped ? 'situationCta.goingLabel' : 'situationCta.rsvpLabel', { name: title })}
          style={[
            styles.primaryBtn,
            {
              backgroundColor: nextFreeCall?.rsvped ? colors.greenLight : colors.primary,
              borderWidth: nextFreeCall?.rsvped ? 1.5 : 0,
              borderColor: colors.green,
            },
          ]}
          onPress={onRsvp}
          activeOpacity={0.85}
        >
          <Text
            style={[
              styles.primaryBtnText,
              { color: nextFreeCall?.rsvped ? colors.green : '#fff' },
            ]}
          >
            {nextFreeCall?.rsvped ? t('situationCta.going') : t('situationCta.rsvp')}
          </Text>
        </TouchableOpacity>
      )}

      {view.question && nextFreeCall && (
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/(tabs)/support', params: { sessionId: nextFreeCall.id, ask: 'question' } })}
          activeOpacity={0.75}
          style={styles.askLink}
        >
          <Text style={[styles.rsvpLinkText, { color: colors.primary }]}>{t('situationCta.askQuestion')}</Text>
        </TouchableOpacity>
      )}
      {view.rsvpNote && (
        <Text style={[styles.rsvpNote, { color: colors.inkSoft }]}>{t('common:familySquares.rsvpNote')}</Text>
      )}
      {/* Family Squares only: what a first visit is like, and (once her seat is
          saved) a reminder ask, every Monday, the calendar file and "can't make it this week". */}
      {view.firstTimerNote && <FamilySquaresFirstTimerNote accountId={accountId} />}
      {isFamilySquares && onDecline && (
        <FamilySquaresSeatPanel
          accountId={accountId}
          rsvp={nextFreeCall?.rsvped ? 'going' : nextFreeCall?.declined ? 'declined' : 'none'}
          onDecline={onDecline}
          reminderAsk={seatReminderAsk}
          seatSavedHere={seatSavedHere}
          cancelled={view.cancelledLine}
        />
      )}
      {isLaSobremesaSession(nextFreeCall) && (
        <Text style={[styles.rsvpNote, { color: colors.inkSoft }]}>{t('common:laSobremesa.note')}</Text>
      )}

      {weeklyOneThing && (
        <View style={[styles.oneThing, { borderTopColor: colors.line }]}>
          <Text style={[styles.oneThingLabel, { color: colors.primary }]}>
            {t(weeklyOneThing.fromCall ? 'situationCta.oneThingFromCall' : 'situationCta.oneThing')}
          </Text>
          <Text style={[styles.oneThingText, { color: colors.ink }]}>{weeklyOneThing.text}</Text>
        </View>
      )}

      {primaryDoor !== 'free_call' && doorRoute && (
        <View style={[styles.doorSection, { borderTopColor: colors.line }]}>
          {/* The escalation moment is when connection with Matt matters most.
              The brief is the lowest-friction door — it asks for consent, not
              money — so it leads; coaching/intervention follow. */}
          <Text style={[styles.doorSub, { color: colors.inkSoft }]}>
            {t('situationCta.sendBriefSub')}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.briefBtn, { backgroundColor: colors.coral }]}
            onPress={() => {
              logFunnelEvent('brief_opened', { source: 'today_door' });
              router.push('/situation-brief' as never);
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.briefBtnText}>{t('situationCta.sendBrief')}</Text>
          </TouchableOpacity>
          <Text style={[styles.doorSub, { color: colors.inkSoft, marginTop: 14 }]}>
            {t(`situationCta.${primaryDoor}Sub`, { rate: coachingRate.rate })}
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.doorBtn, { borderColor: colors.primary }]}
            onPress={() => router.push(doorRoute as never)}
            activeOpacity={0.85}
          >
            <Text style={[styles.doorBtnText, { color: colors.primary }]}>
              {t(DOOR_COPY_KEY[primaryDoor])}
            </Text>
          </TouchableOpacity>
          {/* An escalated situation is exactly when "where do we get help" is
              the live question — the finder is the answer, so offer it here. */}
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => router.push('/finder')}
            activeOpacity={0.75}
            style={styles.finderLink}
          >
            <Text style={[styles.finderLinkText, { color: colors.primary }]}>
              {t('situationCta.finderLink')}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    marginBottom: 16,
  },
  eyebrow: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.6 },
  title: { fontSize: 18, fontWeight: '700', marginTop: 6, letterSpacing: -0.3 },
  schedule: { fontSize: 13.5, marginTop: 3, marginBottom: 14 },
  cancelledLine: { fontSize: 14.5, lineHeight: 21 },
  primaryBtn: {
    borderRadius: 99,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  doorSection: { marginTop: 16, paddingTop: 16, borderTopWidth: 1 },
  doorSub: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
  doorBtn: {
    borderRadius: 99,
    borderWidth: 1.5,
    paddingVertical: 12,
    alignItems: 'center',
  },
  briefBtn: {
    borderRadius: 99,
    paddingVertical: 13,
    alignItems: 'center',
  },
  briefBtnText: { color: '#fff', fontSize: 14.5, fontWeight: '700' },
  doorBtnText: { fontSize: 14.5, fontWeight: '700' },
  finderLink: { alignItems: 'center', marginTop: 12 },
  finderLinkText: { fontSize: 13, fontWeight: '600' },
  rsvpLink: { alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: 4 },
  askLink: { alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: 4 },
  rsvpLinkText: { fontSize: 13, fontWeight: '600' },
  rsvpNote: { fontSize: 12, lineHeight: 17, marginTop: 10 },
  oneThing: { marginTop: 16, paddingTop: 14, borderTopWidth: 1 },
  oneThingLabel: { fontSize: 11.5, fontWeight: '800', letterSpacing: 0.6, marginBottom: 6 },
  oneThingText: { fontSize: 14.5, lineHeight: 21 },
});
