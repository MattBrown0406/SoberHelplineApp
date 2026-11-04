import { Platform } from 'react-native';
import * as NativeSecureStore from 'expo-secure-store';
import { choosePlanStore } from '../lib/webSessionPlanStore';
import { holidayPlanProtectedByteLength, parseHolidayPlan, HOLIDAY_PROTECTED_BYTE_LIMIT, type HolidayPlan } from '../lib/holidayPlan';
import { holidayPlanStorageKey } from '../lib/holidayPlanStorageKeys';

// Native: the protected Keychain/Keystore store. expo-secure-store has no web
// implementation, so on web the plan is kept in sessionStorage for this
// browser session only (the screen says so).
const SecureStore = choosePlanStore(Platform.OS, NativeSecureStore, globalThis);
const OPTIONS: NativeSecureStore.SecureStoreOptions = {
  keychainAccessible: NativeSecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

async function requireProtectedStorage(): Promise<void> {
  if (!(await SecureStore.isAvailableAsync())) throw new Error('protected_storage_unavailable');
}

export async function loadProtectedHolidayPlan(accountId: string): Promise<HolidayPlan> {
  await requireProtectedStorage();
  const raw = await SecureStore.getItemAsync(holidayPlanStorageKey(accountId), OPTIONS);
  return parseHolidayPlan(raw);
}

export async function saveProtectedHolidayPlan(accountId: string, plan: HolidayPlan): Promise<void> {
  await requireProtectedStorage();
  if (holidayPlanProtectedByteLength(plan) > HOLIDAY_PROTECTED_BYTE_LIMIT) throw new Error('protected_holiday_value_too_large');
  await SecureStore.setItemAsync(holidayPlanStorageKey(accountId), JSON.stringify(plan), OPTIONS);
}

export async function clearProtectedHolidayPlan(accountId: string): Promise<void> {
  await requireProtectedStorage();
  await SecureStore.deleteItemAsync(holidayPlanStorageKey(accountId), OPTIONS);
}
