import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@sh:onboarded';

export async function isOnboarded(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return true; // fail open: never trap a user in onboarding
  }
}

export async function markOnboarded(): Promise<void> {
  await AsyncStorage.setItem(KEY, '1');
}
