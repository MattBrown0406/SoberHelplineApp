import AsyncStorage from '@react-native-async-storage/async-storage';
import { personalReminders } from './native';
import { REMINDER_CATEGORIES, type PersonalReminder } from './personalReminders';

/**
 * A bereaved member paused every reminder and note. Her own personal
 * reminders are paused through the reminder service (so nothing is left
 * scheduled) and the ones that were on are remembered on this device, to be
 * scheduled again when she turns reminders back on. The key contains the
 * account id, so the account-deletion purge removes it.
 */
export function quietRemindersKey(accountId: string): string {
  return `personal-reminders:quiet:v1:${encodeURIComponent(accountId)}`;
}

function parseArmed(raw: string | null): PersonalReminder[] {
  if (!raw) return [];
  try {
    const items = JSON.parse(raw) as unknown;
    if (!Array.isArray(items)) return [];
    return items.filter((item): item is PersonalReminder => !!item && typeof item === 'object'
      && (REMINDER_CATEGORIES as readonly string[]).includes((item as PersonalReminder).category)
      && Number.isInteger((item as PersonalReminder).hour) && Number.isInteger((item as PersonalReminder).minute)
      && ['en', 'es'].includes((item as PersonalReminder).locale));
  } catch {
    return [];
  }
}

/**
 * Runs on every re-arm while she is paused, but pauses only once: when the
 * pause starts (no remembered list yet). A reminder she turns on herself
 * during the pause is hers and stays on.
 */
export async function pausePersonalRemindersForQuiet(accountId: string): Promise<void> {
  const key = quietRemindersKey(accountId);
  if ((await AsyncStorage.getItem(key)) !== null) return;
  await personalReminders.setAccount(accountId);
  const snapshot = personalReminders.snapshot();
  if (snapshot.accountId !== accountId || !snapshot.ready) return;
  const armed = snapshot.items.filter((item) => item.enabled);
  // Written even when nothing was on: the pause has started.
  await AsyncStorage.setItem(key, JSON.stringify(armed));
  for (const item of armed) {
    await personalReminders.pause(item.category).catch(() => undefined);
  }
}

export async function resumePersonalRemindersAfterQuiet(accountId: string): Promise<void> {
  const key = quietRemindersKey(accountId);
  const raw = await AsyncStorage.getItem(key);
  if (raw === null) return;
  const armed = parseArmed(raw);
  await personalReminders.restoreAfterAbortedExit(accountId, armed);
  await AsyncStorage.removeItem(key);
}
