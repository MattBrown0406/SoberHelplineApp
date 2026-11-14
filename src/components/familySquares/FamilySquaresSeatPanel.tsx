import React, { useState } from 'react';
import { Linking, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { appAlert } from '../../lib/appAlert';
import { FAMILY_SQUARES_CALENDAR_URL } from '../../lib/websiteLinks';
import { useFamilySquaresWeeklySeat } from '../../hooks/useFamilySquaresWeeklySeat';

/** Her answer for the coming Family Squares meeting. */
export type FamilySquaresRsvp = 'going' | 'declined' | 'none';

interface Props {
  accountId: string | null;
  rsvp: FamilySquaresRsvp;
  /** Switches her saved seat to "can't make it"; answers false when that failed. */
  onDecline: () => Promise<boolean>;
  /** 'onPrimary' is for the onboarding done screen (white on the brand colour). */
  tone?: 'card' | 'onPrimary';
}

/**
 * Shown under a saved Family Squares seat, wherever "You're going" shows
 * (Today's call card, Support, the onboarding done screen):
 * - "Save my seat every Monday": seats are cleared every Tuesday, so this
 *   saves her from doing it again each week.
 * - "Add to my calendar": opens the meeting's calendar file.
 * - "Can't make it this week": for this meeting only; the reminders stop.
 * After she declines, it says so and how to come back.
 */
export function FamilySquaresSeatPanel({ accountId, rsvp, onDecline, tone = 'card' }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const weekly = useFamilySquaresWeeklySeat(accountId);
  const [declining, setDeclining] = useState(false);

  if (rsvp === 'none') return null;

  const onPrimary = tone === 'onPrimary';
  const ink = onPrimary ? '#fff' : colors.ink;
  const soft = onPrimary ? 'rgba(255,255,255,0.8)' : colors.inkSoft;
  const accent = onPrimary ? '#fff' : colors.primary;
  const rule = onPrimary ? 'rgba(255,255,255,0.3)' : colors.line;

  if (rsvp === 'declined') {
    return (
      <View style={[styles.panel, { borderTopColor: rule }]}>
        <Text style={[styles.desc, { color: soft }]} accessibilityLiveRegion="polite">
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
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: 14, paddingTop: 12, borderTopWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1 },
  label: { fontSize: 14, fontWeight: '700' },
  desc: { fontSize: 12.5, lineHeight: 18, marginTop: 2 },
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
  declineLink: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  declineText: { fontSize: 13, fontWeight: '600', textDecorationLine: 'underline' },
});
