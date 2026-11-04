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

export async function pausePersonalRemindersForQuiet(accountId: string): Promise<void> {
  await personalReminders.setAccount(accountId);
  const snapshot = personalReminders.snapshot();
  if (snapshot.accountId !== accountId || !snapshot.ready) return;
  const armed = snapshot.items.filter((item) => item.enabled);
  if (!armed.length) return;
  // Remember every reminder that was on, including ones paused earlier.
  const earlier = parseArmed(await AsyncStorage.getItem(quietRemindersKey(accountId)));
  const remembered = [...earlier.filter((item) => !armed.some((r) => r.category === item.category)), ...armed]
    .map((item) => ({ ...item, enabled: true }));
  await AsyncStorage.setItem(quietRemindersKey(accountId), JSON.stringify(remembered));
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
