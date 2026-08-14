import type { HomecomingItemId } from './homecomingWeek';

export type HomecomingDischargeSection = 'core' | 'housing' | 'sober' | 'outpatient' | 'recovery';

const prefix = (accountId: string) => `soberhelpline.homecoming_week.${accountId}`;

export function homecomingIdentityStorageKey(accountId: string): string {
  return `${prefix(accountId)}.identity`;
}
export function homecomingDischargeStorageKey(accountId: string, section: HomecomingDischargeSection): string {
  return `${prefix(accountId)}.discharge.${section}`;
}
export function homecomingItemStorageKey(accountId: string, id: HomecomingItemId): string {
  return `${prefix(accountId)}.item.${id}`;
}
export function homecomingMetaStorageKey(accountId: string): string {
  return `${prefix(accountId)}.meta`;
}
