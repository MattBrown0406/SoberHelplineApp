import type { TreatmentActionItemId } from './treatmentActionPlan';

export function treatmentActionItemStorageKey(
  accountId: string,
  id: TreatmentActionItemId,
): string {
  return `soberhelpline.treatment_action.${accountId}.${id}`;
}

export function treatmentActionMetaStorageKey(accountId: string): string {
  return `soberhelpline.treatment_action.${accountId}.meta`;
}

export function treatmentActionExecutionStorageKey(accountId: string): string {
  return `soberhelpline.treatment_action.${accountId}.execution`;
}
