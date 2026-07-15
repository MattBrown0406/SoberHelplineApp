import AsyncStorage from '@react-native-async-storage/async-storage';

const LEGACY_KEY = '@sh:onboarded';
const keyFor = (accountId: string) => `${LEGACY_KEY}:${accountId}`;

// Per-account cache prevents one member's completion from skipping onboarding for
// another account on the same device.
const cached = new Map<string, boolean>();
const listeners = new Map<string, Set<() => void>>();

export async function isOnboarded(accountId: string): Promise<boolean> {
  if (cached.has(accountId)) return cached.get(accountId) ?? false;
  try {
    const accountValue = await AsyncStorage.getItem(keyFor(accountId));
    if (accountValue === '1') {
      cached.set(accountId, true);
      return true;
    }

    // One-time migration for devices that completed onboarding before the key
    // became account-scoped. Remove it after assigning it to the active account.
    const legacyValue = await AsyncStorage.getItem(LEGACY_KEY);
    if (legacyValue === '1') {
      await AsyncStorage.setItem(keyFor(accountId), '1');
      await AsyncStorage.removeItem(LEGACY_KEY);
      cached.set(accountId, true);
      return true;
    }

    cached.set(accountId, false);
    return false;
  } catch {
    cached.set(accountId, true); // fail open: never trap a member in onboarding
    return true;
  }
}

export async function markOnboarded(accountId: string): Promise<void> {
  cached.set(accountId, true);
  listeners.get(accountId)?.forEach((fn) => fn());
  try {
    await AsyncStorage.setItem(keyFor(accountId), '1');
  } catch {
    // In-memory state still unblocks this session.
  }
}

export function subscribeOnboarded(accountId: string, fn: () => void): () => void {
  const accountListeners = listeners.get(accountId) ?? new Set<() => void>();
  accountListeners.add(fn);
  listeners.set(accountId, accountListeners);
  return () => {
    accountListeners.delete(fn);
    if (accountListeners.size === 0) listeners.delete(accountId);
  };
}
