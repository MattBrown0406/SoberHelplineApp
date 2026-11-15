import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import { meetingDayLabel } from '../../lib/familySquaresCard';
import { LA_SOBREMESA_CALL_LENGTH_MS, isLaSobremesaSession } from '../../lib/familySquaresSchedule';

interface Props {
  /** callCardView's `confirmed`: her answer is "going" and the week is not cancelled. */
  confirmed: boolean;
  /** The meeting, for its day ("Monday, November 16") in her language and time zone. */
  session: { title?: string | null; next_at?: string | null } | null | undefined;
  /**
   * Goes up when a Save tap on this screen has just saved her seat
   * (useTodayFeed / useSessions): the line is then read out, because the
   * button she tapped is gone.
   */
  savedHere?: number;
  /**
   * Calls other than Family Squares only: the tap the old "Confirmed" /
   * "You're going" button had (La Sobremesa fetches a missing personal link,
   * a plain RSVP is taken back). Family Squares has "Can't make it this week".
   */
  onPress?: () => void;
  /** What that tap's button is called (required with onPress). */
  pressLabel?: string;
  /**
   * Whether the line names the day. Only a Family Squares seat is saved for
   * one dated meeting. Another call's RSVP (La Sobremesa) carries no date and
   * outlives the meeting until the Tuesday reset, while `next_at` has already
   * moved to next week: naming that day would promise a seat she does not have.
   */
  showDate?: boolean;
}

/**
 * The one confirmation on the call card, on Today and on Support: a green
 * check and "Your spot is saved for Monday, November 16". Shown whether or
 * not the meeting's link is set.
 */
export function FamilySquaresSpotSavedLine({ confirmed, session, savedHere = 0, onPress, pressLabel, showDate = true }: Props) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation('common');
  const day = showDate
    ? meetingDayLabel(session?.next_at, {
      locale: i18n.resolvedLanguage ?? i18n.language,
      lengthMs: isLaSobremesaSession(session) ? LA_SOBREMESA_CALL_LENGTH_MS : undefined,
    })
    : null;
  const text = day ? t('familySquares.spotSaved', { date: day }) : t('familySquares.spotSavedNoDate');

  const announced = useRef(savedHere);
  useEffect(() => {
    if (savedHere === announced.current) return;
    announced.current = savedHere;
    if (confirmed) AccessibilityInfo.announceForAccessibility(text);
  }, [savedHere, confirmed, text]);

  if (!confirmed) return null;

  const line = (
    <>
      <View style={[styles.check, { backgroundColor: colors.green }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Text style={styles.checkMark} allowFontScaling={false}>✓</Text>
      </View>
      <Text style={[styles.text, { color: colors.ink }]}>{text}</Text>
    </>
  );
  const box = [styles.box, { backgroundColor: colors.greenLight, borderColor: colors.green }];

  if (onPress) {
    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={pressLabel ?? text}
        onPress={onPress}
        activeOpacity={0.85}
        style={box}
      >
        {line}
      </TouchableOpacity>
    );
  }
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={text} accessibilityLiveRegion="polite" style={box}>
      {line}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  check: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: '800', lineHeight: 16 },
  text: { flex: 1, fontSize: 14.5, lineHeight: 20, fontWeight: '700' },
});
