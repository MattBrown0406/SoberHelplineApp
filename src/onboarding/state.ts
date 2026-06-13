import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@sh:onboarded';

// In-memory cache + subscribers so the root layout's route guard updates the
// instant onboarding completes (AsyncStorage alone is async and went stale,
// which caused an onboarding redirect loop).
let cached: boolean | null = null;
const listeners = new Set<() => void>();

export async function isOnboarded(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    cached = (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    cached = true; // fail open: never trap a user in onboarding
  }
  return cached;
}

export async function markOnboarded(): Promise<void> {
  cached = true;
  listeners.forEach((fn) => fn());
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {
    // in-memory flag still unblocks this session
  }
}

export function subscribeOnboarded(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
