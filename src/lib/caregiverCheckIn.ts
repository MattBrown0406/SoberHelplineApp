import type {
  CaregiverCheckInInput,
  CaregiverSupportNeed,
  CheckIn,
  MoodScore,
} from '../api/types';

export const CAREGIVER_SUPPORT_NEEDS: CaregiverSupportNeed[] = [
  'rest',
  'connection',
  'boundary',
  'plan',
  'safety',
  'steady',
];

export type CaregiverResponseKey =
  | 'safety'
  | 'overloaded'
  | 'connection'
  | 'boundary'
  | 'plan'
  | 'rest'
  | 'steady';

export const CAREGIVER_RESPONSE_ROUTE: Partial<Record<CaregiverResponseKey, string>> = {
  safety: '/safety-wallet',
  overloaded: '/(tabs)/support',
  connection: '/(tabs)/support',
  boundary: '/(tabs)/boundaries',
};

export function caregiverResponseKey(
  checkIn: CaregiverCheckInInput | CheckIn,
): CaregiverResponseKey {
  if (checkIn.supportNeed === 'safety') return 'safety';
  if ((checkIn.capacityScore ?? 3) <= 2 && (checkIn.pressureScore ?? 3) >= 4) {
    return 'overloaded';
  }
  switch (checkIn.supportNeed) {
    case 'connection':
    case 'boundary':
    case 'plan':
    case 'rest':
      return checkIn.supportNeed;
    default:
      return 'steady';
  }
}

export function isMoodScore(value: unknown): value is MoodScore {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5;
}

export function parseSupportNeed(value: unknown): CaregiverSupportNeed | null {
  return CAREGIVER_SUPPORT_NEEDS.includes(value as CaregiverSupportNeed)
    ? (value as CaregiverSupportNeed)
    : null;
}
