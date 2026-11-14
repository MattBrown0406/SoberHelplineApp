import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { bereavedCacheKey } from './bereavement';
import {
  parseReminderAskMemory,
  reminderAskStorageKey,
  reminderPermissionFrom,
  type ReminderAskMemory,
  type ReminderPermission,
} from './reminderAsk';

/** The app sends no reminders on the web, so it never asks there. */
export const REMINDERS_SUPPORTED = Platform.OS !== 'web';

/** Reads the permission without ever opening the system dialog. Null when it cannot be read. */
export async function readReminderPermission(): Promise<ReminderPermission | null> {
  if (!REMINDERS_SUPPORTED) return null;
  try {
    return reminderPermissionFrom(await Notifications.getPermissionsAsync());
  } catch {
    return null;
  }
}

// The key carries the account id, so account deletion removes it with her
// other device data (accountLocalKeys).
/** Null when the device's storage cannot be read: then nothing is asked, never on a guess. */
export async function loadReminderAskMemory(accountId: string): Promise<ReminderAskMemory | null> {
  try {
    return parseReminderAskMemory(await AsyncStorage.getItem(reminderAskStorageKey(accountId)));
  } catch {
    return null;
  }
}

/**
 * The device's copy of "her loved one died" (written by useLovedOne on Today,
 * which is always mounted). A bereaved member is never asked anything; an
 * unreadable or missing copy answers false, as Today itself does.
 */
export async function readBereavedOnDevice(accountId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(bereavedCacheKey(accountId))) === '1';
  } catch {
    return false;
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // One screen failing must not stop the others.
    }
  }
}

/** Today and Support both stay mounted: an answer on one is heard by the other. */
export function subscribeReminderAsk(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Records one or more "asked / dismissed" times. Never throws: an ask must not break the screen. */
export async function rememberReminderAsk(
  accountId: string,
  change: Partial<Omit<ReminderAskMemory, 'schemaVersion'>>,
): Promise<void> {
  try {
    const saved = await loadReminderAskMemory(accountId);
    if (!saved) return;
    await AsyncStorage.setItem(reminderAskStorageKey(accountId), JSON.stringify({ ...saved, ...change }));
  } catch {
    // Not remembered: the worst case is one more gentle ask.
    return;
  }
  notify();
}

/** The permission changed (she answered the dialog, or came back from Settings). */
export function reminderPermissionChanged(): void {
  notify();
}

// Which seat panels are showing their ask right now. Today's second chance
// stays away while one is, so she is never asked twice on one screen.
const seatAsksShowing = new Set<object>();

export function setSeatReminderAskShowing(panel: object, showing: boolean): void {
  const had = seatAsksShowing.has(panel);
  if (showing === had) return;
  if (showing) seatAsksShowing.add(panel);
  else seatAsksShowing.delete(panel);
  notify();
}

export function isSeatReminderAskShowing(): boolean {
  return seatAsksShowing.size > 0;
}
