import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
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
  let storageOwner = 'local';
  let timezone: string | undefined;
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user.id) {
    const { data: account } = await supabase
      .from('accounts')
      .select('id, timezone')
      .eq('user_id', session.user.id)
      .maybeSingle();
    if (account?.id) {
      storageOwner = account.id;
      timezone = account.timezone;
    }
  }
  const checkedInToday = (await getCheckIn(storageOwner, new Date(), timezone)) !== null;
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

  // Sunday 6pm week-in-review — the weekly payoff that pairs with the
  // WeekReviewCard on Today. One-shot; re-armed on every foreground.
  const sunday = new Date();
  sunday.setHours(18, 0, 0, 0);
  sunday.setDate(sunday.getDate() + ((7 - sunday.getDay()) % 7));
  if (sunday <= now) sunday.setDate(sunday.getDate() + 7);
  await Notifications.scheduleNotificationAsync({
    content: {
      title: i18n.t('settings:notifications.weekReviewTitle'),
      body: i18n.t('settings:notifications.weekReviewBody'),
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: sunday },
  });
}

export async function registerForPushNotifications(accountId: string): Promise<boolean> {
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
  if (finalStatus !== 'granted') return false;

  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) throw new Error('EAS project ID is not configured');
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    if (!token) return false;
    // locale drives the language of server-sent pushes (session reminders,
    // win-back, community support) — kept in sync with the app language.
    const { error } = await supabase
      .from('accounts')
      .update({ push_token: token, locale: i18n.language ?? 'en' })
      .eq('id', accountId);
    if (error) throw error;
  } catch (error) {
    // Push failures must be observable: a coach missing a scheduling request is
    // operationally significant. Simulators commonly cannot obtain a token.
    console.warn('[push] registration failed', error);
    return false;
  }

  await rearmDailyNudge();
  return true;
}

export function usePushNotifications(accountId: string | null): void {
  const router = useRouter();

  useEffect(() => {
    if (!accountId) return;
    void registerForPushNotifications(accountId);

    const openSchedulingNotification = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data ?? {};
      const kind = typeof data.kind === 'string' ? data.kind : '';

      if (kind === 'group_live') {
        const roomName = typeof data.room_name === 'string' ? data.room_name : '';
        const allowedRooms = new Set([
          'shp-parents', 'shp-spouses', 'shp-boundaries', 'shp-treatment',
        ]);
        if (allowedRooms.has(roomName)) {
          router.push({ pathname: '/live-room' as never, params: { room: roomName } });
        }
        return;
      }

      const sessionId = typeof data.session_id === 'string' ? data.session_id : '';

      const sessionKinds = new Set([
        'admin_video_request', 'coach_video_accepted', 'coach_video_reschedule',
        'coach_video_cancelled', 'coach_video_reminder', 'member_video_scheduled',
        'member_video_counteroffer', 'member_video_cancelled', 'member_video_live',
        'member_video_completed', 'member_video_no_show', 'premier_video_reminder',
      ]);
      const validSessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId);
      // Route only an explicit allowlist and never consume an unvalidated identifier.
      if (!sessionKinds.has(kind) || !validSessionId) return;
      if (kind === 'member_video_live') {
        router.push({ pathname: '/video-session' as never, params: { sessionId } });
      } else if (kind.startsWith('admin_') || kind.startsWith('coach_')) {
        router.push('/admin' as never);
      } else {
        router.push('/support' as never);
      }
    };

    const responseSub = Notifications.addNotificationResponseReceivedListener(openSchedulingNotification);
    void Notifications.getLastNotificationResponseAsync().then(async (response) => {
      if (!response) return;
      try {
        openSchedulingNotification(response);
      } finally {
        await Notifications.clearLastNotificationResponseAsync();
      }
    });

    // Re-arm on foreground so the rolling week stays topped up and today's
    // nudge drops the moment the user checks in within the session.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void rearmDailyNudge();
    });
    return () => {
      responseSub.remove();
      appStateSub.remove();
    };
  }, [accountId, router]);
}
