import React, { useState } from 'react';
import { Linking, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { appAlert } from '../../lib/appAlert';
import { FAMILY_SQUARES_CALENDAR_URL } from '../../lib/websiteLinks';
import { useFamilySquaresWeeklySeat } from '../../hooks/useFamilySquaresWeeklySeat';
import { useSeatReminderAsk } from '../../hooks/useReminderAsk';
import { useFamilySquaresSeatRefused } from '../../hooks/useFamilySquaresSeatRefused';
import { ReminderAskNote } from '../reminders/ReminderAskNote';
import { seatPanelView } from '../../lib/familySquaresCard';

/** Her answer for the coming Family Squares meeting. */
export type FamilySquaresRsvp = 'going' | 'declined' | 'none';

interface Props {
  accountId: string | null;
  rsvp: FamilySquaresRsvp;
  /** Switches her saved seat to "can't make it"; answers false when that failed. */
  onDecline: () => Promise<boolean>;
  /** 'onPrimary' is for the onboarding done screen (white on the brand colour). */
  tone?: 'card' | 'onPrimary';
  /**
   * Today and Support: right after she saves her seat, offer a reminder if
   * this device has no notification permission. Left off on the onboarding
   * done screen, which asked a moment earlier.
   */
  reminderAsk?: boolean;
  /**
   * Goes up each time her own Save tap on this screen has just saved her seat
   * (useTodayFeed / useSessions). The reminder ask follows only that.
   */
  seatSavedHere?: number;
  /** The website cancelled the coming Monday: only the "every Monday" switch is shown. */
  cancelled?: boolean;
}

/**
 * Shown under a saved Family Squares seat, wherever "You're going" shows
 * (Today's call card, Support, the onboarding done screen):
 * - "Save my seat every Monday": seats are cleared every Tuesday, so this
 *   saves her from doing it again each week.
 * - "Add to my calendar": opens the meeting's calendar file.
 * - "Can't make it this week": for this meeting only; the reminders stop.
 * After she declines, it says so and how to come back.
 * With `reminderAsk`, a seat she has just saved is followed by a short ask to
 * turn on reminders (see ReminderAskNote).
 * With no seat yet but her weekly seat on, it says her seat is usually saved
 * for her (so the card's "Save my spot" does not look as if the switch were
 * off). Not when the website just refused her a seat for the coming meeting
 * on this device: she sees the switch by itself.
 * On a cancelled week it shows the switch and nothing else.
 * Which of these it is: seatPanelView (familySquaresCard).
 */
export function FamilySquaresSeatPanel({ accountId, rsvp, onDecline, tone = 'card', reminderAsk = false, seatSavedHere = 0, cancelled = false }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const weekly = useFamilySquaresWeeklySeat(accountId);
  const [declining, setDeclining] = useState(false);
  // Watches for the moment her seat is saved, so it runs for every answer.
  // (A cancelled week has no seat to be reminded of: nothing is asked.)
  const reminders = useSeatReminderAsk(accountId, cancelled ? 'none' : rsvp, reminderAsk && !cancelled, seatSavedHere);
  // "Your seat is saved for you" is said only where it is true: not for a
  // meeting the website has just refused her a seat for.
  const refusedHere = useFamilySquaresSeatRefused(accountId);
  const panelView = seatPanelView({ cancelled, answer: rsvp, weeklySeatOn: weekly.enabled, weeklyNoteHeld: refusedHere });

  if (panelView === 'hidden') return null;

  const onPrimary = tone === 'onPrimary';
  const ink = onPrimary ? '#fff' : colors.ink;
  const soft = onPrimary ? 'rgba(255,255,255,0.8)' : colors.inkSoft;
  const accent = onPrimary ? '#fff' : colors.primary;
  const rule = onPrimary ? 'rgba(255,255,255,0.3)' : colors.line;

  if (panelView === 'declined') {
    return (
      <View style={[styles.panel, { borderTopColor: rule }]}>
        <Text style={[styles.desc, { color: soft }]} accessibilityLiveRegion="polite">
          {/* "Saved again from next Monday" only where the weekly seat really is saved for her. */}
          {t(weekly.enabled ? 'familySquares.decline.doneWeekly' : 'familySquares.decline.done')}
        </Text>
      </View>
    );
  }

  async function toggleWeekly(next: boolean): Promise<void> {
    if (!(await weekly.setEnabled(next))) {
      appAlert(t('familySquares.weekly.errorTitle'), t('familySquares.weekly.errorBody'));
    }
  }

  async function addToCalendar(): Promise<void> {
    try {
      await Linking.openURL(FAMILY_SQUARES_CALENDAR_URL);
    } catch {
      appAlert(t('familySquares.calendar.errorTitle'), t('familySquares.calendar.errorBody'));
    }
  }

  async function decline(): Promise<void> {
    if (declining) return;
    setDeclining(true);
    const declined = await onDecline().catch(() => false);
    setDeclining(false);
    if (!declined) appAlert(t('familySquares.decline.errorTitle'), t('familySquares.decline.errorBody'));
  }

  return (
    <View style={[styles.panel, { borderTopColor: rule }]}>
      {panelView === 'full' && <ReminderAskNote ask={reminders} place="seat" />}
      {panelView === 'weekly_note' && (
        // Her switch is on, but the coming Monday's seat is not saved yet.
        // ("Within a few hours": the server saves weekly seats every 15
        // minutes, but only once the Tuesday 2 AM Pacific reset has cleared
        // last night's, so the longest usual wait is Monday night's.)
        <Text style={[styles.desc, styles.weeklyNote, { color: ink }]} accessibilityLiveRegion="polite">
          {t('familySquares.weekly.onNote')}
        </Text>
      )}
      <View style={styles.row}>
        <View style={styles.rowText}>
          <Text style={[styles.label, { color: ink }]}>{t('familySquares.weekly.title')}</Text>
          <Text style={[styles.desc, { color: soft }]}>{t('familySquares.weekly.desc')}</Text>
        </View>
        <Switch
          value={weekly.enabled}
          onValueChange={(next) => void toggleWeekly(next)}
          disabled={weekly.busy || !accountId}
          trackColor={{ false: rule, true: onPrimary ? colors.green : colors.primary }}
          thumbColor="#fff"
          accessibilityRole="switch"
          accessibilityLabel={t('familySquares.weekly.title')}
          accessibilityHint={t('familySquares.weekly.desc')}
        />
      </View>
      {/* The calendar file and "can't make it" belong to a saved seat only. */}
      {panelView === 'full' && (
        <>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('familySquares.calendar.label')}
            onPress={() => void addToCalendar()}
            activeOpacity={0.8}
            style={[styles.calendarBtn, { borderColor: accent }]}
          >
            <Text style={[styles.calendarBtnText, { color: accent }]}>{t('familySquares.calendar.button')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('familySquares.decline.label')}
            accessibilityState={{ disabled: declining, busy: declining }}
            disabled={declining}
            onPress={() => void decline()}
            activeOpacity={0.75}
            style={styles.declineLink}
          >
            <Text style={[styles.declineText, { color: soft }]}>{t('familySquares.decline.button')}</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: 12, paddingTop: 12, borderTopWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1 },
  label: { fontSize: 14, fontWeight: '700' },
  desc: { fontSize: 12.5, lineHeight: 18, marginTop: 2 },
  weeklyNote: { marginTop: 0, marginBottom: 10 },
  calendarBtn: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 99,
    borderWidth: 1.5,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  calendarBtnText: { fontSize: 14, fontWeight: '700' },
  declineLink: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  declineText: { fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
});
