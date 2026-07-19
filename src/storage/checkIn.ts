import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CheckIn } from '../api/types';

const KEY_PREFIX = '@sh:checkin:';
const LEGACY_KEY_PREFIX = '@sh:checkin:';

function ownerKey(accountId: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(accountId)}:`;
}

function dateKey(accountId: string, date: Date, timezone?: string): string {
  return ownerKey(accountId) + toDateStr(date, timezone);
}

/** Calendar date as YYYY-MM-DD in the supplied IANA timezone. */
export function toDateStr(date: Date, timezone?: string): string {
  if (!timezone) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return toDateStr(date);
  }
}

export async function getCheckIn(accountId: string, date: Date, timezone?: string): Promise<CheckIn | null> {
  try {
    const key = dateKey(accountId, date, timezone);
    const raw = await AsyncStorage.getItem(key);
    if (raw) return JSON.parse(raw) as CheckIn;

    // Migrate only a legacy record that proves it belongs to this account.
    const legacyKey = LEGACY_KEY_PREFIX + toDateStr(date, timezone);
    const legacyRaw = await AsyncStorage.getItem(legacyKey);
    if (!legacyRaw) return null;
    const legacy = JSON.parse(legacyRaw) as CheckIn;
    if (legacy.userId !== accountId) return null;
    await AsyncStorage.setItem(key, legacyRaw);
    await AsyncStorage.removeItem(legacyKey);
    return legacy;
  } catch {
    return null;
  }
}

export async function saveCheckIn(checkIn: CheckIn, timezone?: string): Promise<void> {
  await AsyncStorage.setItem(
    dateKey(checkIn.userId, new Date(checkIn.completedAt), timezone),
    JSON.stringify(checkIn),
  );
}

/** Returns this account's completed local dates, newest first. */
export async function getCheckedInDates(accountId: string, maxDays = 90): Promise<string[]> {
  try {
    const prefix = ownerKey(accountId);
    const allKeys = await AsyncStorage.getAllKeys();
    return allKeys
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .sort()
      .reverse()
      .slice(0, maxDays);
  } catch {
    return [];
  }
}
