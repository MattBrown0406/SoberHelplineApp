import { Platform } from 'react-native';
import * as NativeSecureStore from 'expo-secure-store';
import { choosePlanStore } from '../lib/webSessionPlanStore';
import { familyVisitationProtectedByteLength, parseFamilyVisitationPlan, VISITATION_PROTECTED_BYTE_LIMIT, type FamilyVisitationPlan } from '../lib/familyVisitationPlan';
import { familyVisitationStorageKey } from '../lib/familyVisitationStorageKeys';

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

export async function loadProtectedFamilyVisitationPlan(accountId: string): Promise<FamilyVisitationPlan> {
  await requireProtectedStorage();
  const raw = await SecureStore.getItemAsync(familyVisitationStorageKey(accountId), OPTIONS);
  return parseFamilyVisitationPlan(raw);
}

export async function saveProtectedFamilyVisitationPlan(accountId: string, plan: FamilyVisitationPlan): Promise<void> {
  await requireProtectedStorage();
  if (familyVisitationProtectedByteLength(plan) > VISITATION_PROTECTED_BYTE_LIMIT) throw new Error('protected_visitation_value_too_large');
  await SecureStore.setItemAsync(familyVisitationStorageKey(accountId), JSON.stringify(plan), OPTIONS);
}

export async function clearProtectedFamilyVisitationPlan(accountId: string): Promise<void> {
  await requireProtectedStorage();
  await SecureStore.deleteItemAsync(familyVisitationStorageKey(accountId), OPTIONS);
}
