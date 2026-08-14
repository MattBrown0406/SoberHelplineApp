import * as SecureStore from 'expo-secure-store';
import { parseFamilyVisitationPlan, type FamilyVisitationPlan } from '../lib/familyVisitationPlan';
import { familyVisitationStorageKey } from '../lib/familyVisitationStorageKeys';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
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
  await SecureStore.setItemAsync(familyVisitationStorageKey(accountId), JSON.stringify(plan), OPTIONS);
}

export async function clearProtectedFamilyVisitationPlan(accountId: string): Promise<void> {
  await requireProtectedStorage();
  await SecureStore.deleteItemAsync(familyVisitationStorageKey(accountId), OPTIONS);
}
