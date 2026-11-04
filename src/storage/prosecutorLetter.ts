import { Platform } from 'react-native';
import * as NativeSecureStore from 'expo-secure-store';
import { choosePlanStore } from '../lib/webSessionPlanStore';
import { prosecutorLetterProtectedByteLength, parseProsecutorLetter, PROSECUTOR_PROTECTED_BYTE_LIMIT, type ProsecutorLetter } from '../lib/prosecutorLetter';
import { prosecutorLetterStorageKey } from '../lib/prosecutorLetterStorageKeys';

// Native: the protected Keychain/Keystore store. expo-secure-store has no web
// implementation, so on web the letter is kept in sessionStorage for this
// browser session only (the screen says so).
const SecureStore = choosePlanStore(Platform.OS, NativeSecureStore, globalThis);
const OPTIONS: NativeSecureStore.SecureStoreOptions = {
  keychainAccessible: NativeSecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

async function requireProtectedStorage(): Promise<void> {
  if (!(await SecureStore.isAvailableAsync())) throw new Error('protected_storage_unavailable');
}

export async function loadProtectedProsecutorLetter(accountId: string): Promise<ProsecutorLetter> {
  await requireProtectedStorage();
  const raw = await SecureStore.getItemAsync(prosecutorLetterStorageKey(accountId), OPTIONS);
  return parseProsecutorLetter(raw);
}

export async function saveProtectedProsecutorLetter(accountId: string, plan: ProsecutorLetter): Promise<void> {
  await requireProtectedStorage();
  if (prosecutorLetterProtectedByteLength(plan) > PROSECUTOR_PROTECTED_BYTE_LIMIT) throw new Error('protected_prosecutor_value_too_large');
  await SecureStore.setItemAsync(prosecutorLetterStorageKey(accountId), JSON.stringify(plan), OPTIONS);
}

export async function clearProtectedProsecutorLetter(accountId: string): Promise<void> {
  await requireProtectedStorage();
  await SecureStore.deleteItemAsync(prosecutorLetterStorageKey(accountId), OPTIONS);
}
