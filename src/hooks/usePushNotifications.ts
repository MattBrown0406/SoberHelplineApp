import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from '../i18n';
import { supabase } from '../lib/supabase';
import { getCheckIn } from '../storage/checkIn';
import { AsyncWriteBarrier } from '../lib/appFlowGuards';
import { getPushDestination, shouldHandlePushResponse } from '../lib/pushRouting';

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
const pushWriteBarrier = new AsyncWriteBarrier();
let activePushAccountId: string | null = null;
let nudgeRearmQueue: Promise<void> = Promise.resolve();

/** Invalidate token acquisition and wait for an already-started write to settle. */
export async function cancelPushRegistration(accountId: string): Promise<void> {
  if (activePushAccountId === accountId) activePushAccountId = null;
  await pushWriteBarrier.cancelAndWait(accountId);
}

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
async function performDailyNudgeRearm(): Promise<void> {
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

/** Serialize re-arms so overlapping foreground/save/settings events cannot interleave. */
export function rearmDailyNudge(): Promise<void> {
  const task = nudgeRearmQueue.then(performDailyNudgeRearm, performDailyNudgeRearm);
  nudgeRearmQueue = task.catch(() => undefined);
  return task;
}

export async function registerForPushNotifications(accountId: string): Promise<boolean> {
  activePushAccountId = accountId;
  const generation = pushWriteBarrier.begin(accountId);
  try {
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

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) throw new Error('EAS project ID is not configured');
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    if (!token) return false;
    if (!pushWriteBarrier.isCurrent(accountId, generation) || activePushAccountId !== accountId) return false;

    // Transfer this device token to the current authenticated account in one
    // server transaction so account switching cannot leave two owners.
    const tokenWrite = pushWriteBarrier.track(accountId, Promise.resolve(supabase.rpc(
      'register_push_device',
      { p_token: token, p_locale: i18n.language ?? 'en' },
    )));
    const { data, error } = await tokenWrite;
    if (error || data !== true) throw error ?? new Error('push_token_not_registered');
    if (!pushWriteBarrier.isCurrent(accountId, generation) || activePushAccountId !== accountId) return false;

    await rearmDailyNudge().catch((error) => {
      console.warn('[push] local nudge rearm failed', error);
    });
    return true;
  } catch (error) {
    // Includes native permission/channel calls so callers never receive an
    // unhandled rejection or remain stuck in a busy state.
    console.warn('[push] registration failed', error);
    return false;
  }
}

export function usePushNotifications(accountId: string | null, navigationReady: boolean): void {
  const router = useRouter();

  useEffect(() => {
    if (!accountId) return;
    void registerForPushNotifications(accountId).catch(() => false);

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void rearmDailyNudge();
    });
    return () => {
      appStateSub.remove();
      void cancelPushRegistration(accountId);
    };
  }, [accountId]);

  useEffect(() => {
    if (!accountId || !navigationReady) return;
    let effectActive = true;

    const openNotification = async (
      response: Notifications.NotificationResponse,
    ): Promise<boolean> => {
      const rawData = response.notification.request.content.data ?? {};
      const data = rawData as Record<string, unknown>;
      const destination = getPushDestination(data);
      // Malformed, unsupported, or expired payloads are intentionally discarded.
      if (!destination) return true;

      if (destination.pathname === '/rehearsal-incoming') {
        const { data: valid, error } = await supabase.rpc('validate_practice_push_event', {
          p_event_id: destination.params.eventId,
        });
        if (!effectActive) return false;
        if (error) {
          console.warn('[push] practice event validation failed', error);
          return false;
        }
        if (valid !== true) return true;
      }

      if (!effectActive) return false;
      if (!shouldHandlePushResponse(data, response.notification.request.identifier)) return true;
      try {
        router.push(destination as never);
        return true;
      } catch (error) {
        console.warn('[push] notification navigation failed', error);
        return false;
      }
    };

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      void openNotification(response);
    });
    void Notifications.getLastNotificationResponseAsync()
      .then(async (response) => {
        if (!response) return;
        const shouldClear = await openNotification(response);
        if (shouldClear) await Notifications.clearLastNotificationResponseAsync();
      })
      .catch((error) => console.warn('[push] cold-start response failed', error));

    return () => {
      effectActive = false;
      responseSub.remove();
    };
  }, [accountId, navigationReady, router]);
}
