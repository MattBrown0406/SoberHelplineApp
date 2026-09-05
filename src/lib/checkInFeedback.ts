import type { CaregiverCheckInInput, CheckIn } from '../api/types';
import { caregiverResponseKey } from './caregiverCheckIn';
export function checkInFeedback(checkIn: CaregiverCheckInInput | CheckIn) {
  const basic = caregiverResponseKey(checkIn);
  const key = basic === 'steady' && checkIn.moodScore <= 2 ? 'lowMood' : basic;
  const route = ({ safety: '/safety-wallet', overloaded: '/(tabs)/support', connection: '/(tabs)/support', boundary: '/(tabs)/boundaries', plan: '/guided-journey', rest: '/(tabs)/scripts', steady: '/(tabs)/learn', lowMood: '/(tabs)/support' } as const)[key];
  return { key, route } as const;
}
