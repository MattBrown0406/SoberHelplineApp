import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import type { ReminderAsk } from '../../hooks/useReminderAsk';

interface Props {
  ask: ReminderAsk;
  /** 'seat' sits under a saved Family Squares seat; 'today' is Today's own small card. */
  place: 'seat' | 'today';
}

/**
 * The in-app ask that comes before the system permission dialog: one sentence
 * on what she gets, then "Remind me" / "Not now". Only "Remind me" opens the
 * system dialog. When she has already said no to the system, one line says
 * reminders are off and offers device Settings instead.
 */
export function ReminderAskNote({ ask, place }: Props) {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const { view, busy } = ask;
  if (!view) return null;

  const onToday = place === 'today';
  const frame = [
    onToday ? styles.card : styles.note,
    { backgroundColor: onToday ? colors.white : colors.primaryLight, borderColor: colors.line },
  ];

  if (view === 'on') {
    return (
      <View style={frame}>
        <Text style={[styles.body, { color: colors.ink }]} accessibilityLiveRegion="polite">
          {t('reminderAsk.on')}
        </Text>
      </View>
    );
  }

  const body = view === 'settings'
    ? t('reminderAsk.settingsBody')
    : view === 'failed'
      ? t('reminderAsk.failed')
      : t(onToday ? 'reminderAsk.todayBody' : 'reminderAsk.seatBody');
  const primary = view === 'settings'
    ? { text: t('reminderAsk.openSettings'), label: t('reminderAsk.openSettingsLabel'), onPress: ask.openSettings }
    : view === 'failed'
      ? { text: t('reminderAsk.tryAgain'), label: t('reminderAsk.tryAgainLabel'), onPress: ask.remindMe }
      : { text: t('reminderAsk.remindMe'), label: t('reminderAsk.remindMeLabel'), onPress: ask.remindMe };
  // Under a saved seat the "off in Settings" line is just the line and its
  // button; everywhere else she can wave the ask away.
  const dismissible = view === 'ask' || (onToday && view === 'settings');

  return (
    <View style={frame}>
      <Text style={[styles.body, { color: colors.ink }]} accessibilityLiveRegion={view === 'ask' ? 'none' : 'polite'}>
        {body}
      </Text>
      <View style={styles.actions}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={primary.label}
          accessibilityState={{ disabled: busy, busy }}
          disabled={busy}
          onPress={primary.onPress}
          activeOpacity={0.85}
          style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]}
        >
          <Text style={styles.primaryBtnText}>{primary.text}</Text>
        </TouchableOpacity>
        {dismissible && (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('reminderAsk.notNowLabel')}
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={ask.notNow}
            activeOpacity={0.75}
            style={styles.notNow}
          >
            <Text style={[styles.notNowText, { color: colors.inkSoft }]}>{t('reminderAsk.notNow')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  note: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6, marginBottom: 12 },
  card: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 8, marginBottom: 16 },
  body: { fontSize: 13.5, lineHeight: 20, marginBottom: 6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  primaryBtn: { minHeight: 44, justifyContent: 'center', borderRadius: 99, paddingHorizontal: 18 },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  notNow: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 },
  notNowText: { fontSize: 13.5, fontWeight: '600' },
});
