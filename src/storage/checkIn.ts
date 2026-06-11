import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CheckIn } from '../api/types';

const KEY_PREFIX = '@sh:checkin:';

function dateKey(date: Date): string {
  return KEY_PREFIX + toDateStr(date);
}

export function toDateStr(date: Date): string {
  return date.toISOString().split('T')[0];
}

export async function getCheckIn(date: Date): Promise<CheckIn | null> {
  try {
    const raw = await AsyncStorage.getItem(dateKey(date));
    return raw ? (JSON.parse(raw) as CheckIn) : null;
  } catch {
    return null;
  }
}

export async function saveCheckIn(checkIn: CheckIn): Promise<void> {
  await AsyncStorage.setItem(dateKey(new Date(checkIn.completedAt)), JSON.stringify(checkIn));
}

/**
 * Returns up to maxDays of completed dates (YYYY-MM-DD), newest first.
 * Used by the streak calculator in useCheckIn.
 * When a sync layer is added, merge these with server-confirmed dates.
 */
export async function getCheckedInDates(maxDays = 90): Promise<string[]> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    return allKeys
      .filter((k) => k.startsWith(KEY_PREFIX))
      .map((k) => k.replace(KEY_PREFIX, ''))
      .sort()
      .reverse()
      .slice(0, maxDays);
  } catch {
    return [];
  }
}
