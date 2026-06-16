import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

async function scheduleDailyNudge(title: string, body: string): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: 9,
      minute: 0,
    },
  });
}

export async function registerForPushNotifications(
  accountId: string,
  title: string,
  body: string,
): Promise<void> {
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

  await scheduleDailyNudge(title, body);
}

export function usePushNotifications(
  accountId: string | null,
  title: string,
  body: string,
): void {
  useEffect(() => {
    if (!accountId) return;
    registerForPushNotifications(accountId, title, body);
  }, [accountId]);
}
