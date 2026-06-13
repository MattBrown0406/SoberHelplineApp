import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CheckIn } from '../api/types';

const KEY_PREFIX = '@sh:checkin:';

function dateKey(date: Date): string {
  return KEY_PREFIX + toDateStr(date);
}

/**
 * Local calendar date as YYYY-MM-DD. Uses the device's own day boundary so a
 * new check-in is requested at local midnight (12:01 AM) — not UTC midnight,
 * which for US users would flip the counter mid-afternoon.
 */
export function toDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** UTC instants bounding the given local calendar day — for ranged DB queries. */
export function localDayRangeUtc(date: Date): { startIso: string; endIso: string } {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
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
