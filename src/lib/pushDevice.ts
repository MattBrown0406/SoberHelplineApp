import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/**
 * Stop this device receiving remote pushes. Used when the device forgets an
 * account without reaching the server (offline sign-out): the server still
 * holds the push token until the account signs in again, so a shared phone
 * would otherwise keep showing that member's notifications. The next
 * registration (any sign-in) re-registers the device.
 */
export async function stopDevicePushDelivery(): Promise<void> {
  if (Platform.OS === 'web') return;
  await Notifications.unregisterForNotificationsAsync();
}

// Whether an account is active on this device, including the offline account
// fallback. Kept in memory and set by AccountContext so the foreground
// notification handler can decide synchronously (expo-notifications drops a
// notification whose handler takes more than ~3s; an auth refresh offline can).
let deviceSignedIn = false;

export function setDeviceSignedIn(value: boolean): void {
  deviceSignedIn = value;
}

export function isDeviceSignedIn(): boolean {
  return deviceSignedIn;
}
