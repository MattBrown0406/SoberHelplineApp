import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from '../i18n';
import { supabase } from '../lib/supabase';
import { getCheckIn } from '../storage/checkIn';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const REMINDER_HOUR_KEY = 'reminderHour';
export const DEFAULT_REMINDER_HOUR = 9;
const NUDGE_DAYS = 7; // schedule a week of nudges ahead so non-openers still get pinged

export async function getReminderHour(): Promise<number> {
  const raw = await AsyncStorage.getItem(REMINDER_HOUR_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : DEFAULT_REMINDER_HOUR;
}

export async function setReminderHour(hour: number): Promise<void> {
  await AsyncStorage.setItem(REMINDER_HOUR_KEY, String(hour));
  await rearmDailyNudge();
}

function nudgeBodies(): string[] {
  const arr = i18n.t('settings:notifications.dailyNudgeBodies', { returnObjects: true });
  if (Array.isArray(arr) && arr.length) return arr as string[];
  return [i18n.t('settings:notifications.dailyNudgeBody')];
}

/**
 * (Re)schedules the daily check-in nudge. Three behaviours that make it feel
 * like a supportive companion rather than a nag:
 *   1. Skips today entirely if the user has already checked in.
 *   2. Rotates the message copy so it never reads the same two days running.
 *   3. Fires at the user's chosen hour (Settings), defaulting to 9am.
 * Schedules a rolling week so users who don't open the app daily still get
 * reminders. Safe to call repeatedly (it cancels and re-arms).
 */
export async function rearmDailyNudge(): Promise<void> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  // NOTE: this owns the full local schedule. If session reminders are added as
  // local notifications later, switch from cancelAll to per-identifier cancels.
  await Notifications.cancelAllScheduledNotificationsAsync();

  const hour = await getReminderHour();
  const title = i18n.t('settings:notifications.dailyNudgeTitle');
  const bodies = nudgeBodies();
  const checkedInToday = (await getCheckIn(new Date())) !== null;
  const now = new Date();

  for (let i = 0; i < NUDGE_DAYS; i++) {
    const fire = new Date();
    fire.setHours(hour, 0, 0, 0);
    fire.setDate(fire.getDate() + i);
    if (fire <= now) continue; // today's slot already passed
    if (i === 0 && checkedInToday) continue; // already checked in → don't nag today
    await Notifications.scheduleNotificationAsync({
      content: { title, body: bodies[i % bodies.length] },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: fire },
    });
  }
}

export async function registerForPushNotifications(accountId: string): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return;

  try {
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    if (token) {
      await supabase.from('accounts').update({ push_token: token }).eq('id', accountId);
    }
  } catch {
    // Simulator or no EAS project ID — skip token storage, still schedule local nudge
  }

  await rearmDailyNudge();
}

export function usePushNotifications(accountId: string | null): void {
  useEffect(() => {
    if (!accountId) return;
    void registerForPushNotifications(accountId);
    // Re-arm on foreground so the rolling week stays topped up and today's
    // nudge drops the moment the user checks in within the session.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void rearmDailyNudge();
    });
    return () => sub.remove();
  }, [accountId]);
}
