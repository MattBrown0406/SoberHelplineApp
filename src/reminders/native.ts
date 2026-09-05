import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Crypto from 'expo-crypto';
import { PersonalReminderService, REMINDER_PREFIX } from './personalReminders';
import { reminderCopy } from './copy';

export const personalReminders = new PersonalReminderService({
  supported: Platform.OS === 'ios' || Platform.OS === 'android',
  read: key => AsyncStorage.getItem(key),
  write: (key, value) => AsyncStorage.setItem(key, value),
  list: async () => (await Notifications.getAllScheduledNotificationsAsync()).map(n => n.identifier),
  cancel: async id => {
    await Notifications.cancelScheduledNotificationAsync(id);
    // Remove an already delivered item too; never clear other features' notifications.
    await Notifications.dismissNotificationAsync(id);
  },
  permission: async request => {
    if (request && Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('personal-reminders', {
        name: 'Personal reminders', importance: Notifications.AndroidImportance.LOW,
        sound: null, vibrationPattern: [0], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
    }
    let permission = await Notifications.getPermissionsAsync();
    if (request && !permission.granted && permission.canAskAgain) {
      permission = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: false, allowBadge: false } });
    }
    return permission.granted;
  },
  id: () => `${REMINDER_PREFIX}${Crypto.randomUUID()}`,
  schedule: async (identifier, hour, minute, locale) => {
    const copy = reminderCopy[locale];
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: { title: copy.notificationTitle, body: copy.notificationBody, sound: false, data: {} },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute, channelId: 'personal-reminders' },
    });
  },
});

/** Parent may await before logout/account deletion; throws if cancellation is unconfirmed. */
export function cancelPersonalRemindersForLogout() { return personalReminders.setAccount(null); }
