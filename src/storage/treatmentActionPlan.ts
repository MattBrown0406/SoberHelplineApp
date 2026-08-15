import * as SecureStore from 'expo-secure-store';
import {
  parseProtectedTreatmentActionItem,
  parseProtectedTreatmentExecution,
  parseProtectedTreatmentMeta,
  parseProtectedTreatmentPlacement,
  parseTreatmentActionPlan,
  serializeProtectedTreatmentActionItem,
  serializeProtectedTreatmentExecution,
  serializeProtectedTreatmentMeta,
  serializeProtectedTreatmentPlacement,
  TREATMENT_ACTION_ITEMS,
  type TreatmentActionExecution,
  type TreatmentActionItemId,
  type TreatmentActionItemState,
  type TreatmentActionPlan,
  type TreatmentPlacementDetails,
} from '../lib/treatmentActionPlan';
import {
  treatmentActionExecutionStorageKey,
  treatmentActionItemStorageKey,
  treatmentActionMetaStorageKey,
  treatmentActionPlacementStorageKey,
} from '../lib/treatmentActionStorageKeys';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

async function requireProtectedStorage(): Promise<void> {
  if (!(await SecureStore.isAvailableAsync())) {
    throw new Error('protected_storage_unavailable');
  }
}

async function awaitEvery(operations: Promise<void>[]): Promise<void> {
  const results = await Promise.allSettled(operations);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) throw failure.reason;
}

export async function loadProtectedTreatmentActionPlan(accountId: string): Promise<TreatmentActionPlan> {
  await requireProtectedStorage();
  const [metaRaw, executionRaw, placementRaw, ...itemRows] = await Promise.all([
    SecureStore.getItemAsync(treatmentActionMetaStorageKey(accountId), OPTIONS),
    SecureStore.getItemAsync(treatmentActionExecutionStorageKey(accountId), OPTIONS),
    SecureStore.getItemAsync(treatmentActionPlacementStorageKey(accountId), OPTIONS),
    ...TREATMENT_ACTION_ITEMS.map((definition) =>
      SecureStore.getItemAsync(treatmentActionItemStorageKey(accountId, definition.id), OPTIONS)),
  ]);

  const items: Record<string, unknown> = {};
  TREATMENT_ACTION_ITEMS.forEach((definition, index) => {
    const item = parseProtectedTreatmentActionItem(itemRows[index]);
    if (item) items[definition.id] = item;
  });

  const updatedAt = parseProtectedTreatmentMeta(metaRaw);
  const execution = parseProtectedTreatmentExecution(executionRaw);
  const placementDetails = parseProtectedTreatmentPlacement(placementRaw);
  return parseTreatmentActionPlan(JSON.stringify({ items, execution, placementDetails, updatedAt }));
}

export async function saveProtectedTreatmentActionItem(
  accountId: string,
  id: TreatmentActionItemId,
  item: TreatmentActionItemState,
  updatedAt: string | null,
): Promise<void> {
  await requireProtectedStorage();
  await SecureStore.setItemAsync(treatmentActionItemStorageKey(accountId, id), serializeProtectedTreatmentActionItem(item), OPTIONS);
  await SecureStore.setItemAsync(treatmentActionMetaStorageKey(accountId), serializeProtectedTreatmentMeta(updatedAt), OPTIONS);
}

export async function saveProtectedTreatmentActionExecution(
  accountId: string,
  execution: TreatmentActionExecution,
  updatedAt: string | null,
): Promise<void> {
  await requireProtectedStorage();
  await SecureStore.setItemAsync(
    treatmentActionExecutionStorageKey(accountId),
    serializeProtectedTreatmentExecution(execution),
    OPTIONS,
  );
  await SecureStore.setItemAsync(treatmentActionMetaStorageKey(accountId), serializeProtectedTreatmentMeta(updatedAt), OPTIONS);
}

export async function saveProtectedTreatmentPlacementDetails(
  accountId: string,
  placementDetails: TreatmentPlacementDetails,
  updatedAt: string | null,
): Promise<void> {
  await requireProtectedStorage();
  await SecureStore.setItemAsync(
    treatmentActionPlacementStorageKey(accountId),
    serializeProtectedTreatmentPlacement(placementDetails),
    OPTIONS,
  );
  await SecureStore.setItemAsync(treatmentActionMetaStorageKey(accountId), serializeProtectedTreatmentMeta(updatedAt), OPTIONS);
}

export async function clearProtectedTreatmentActionPlan(accountId: string): Promise<void> {
  await requireProtectedStorage();
  await awaitEvery([
    SecureStore.deleteItemAsync(treatmentActionMetaStorageKey(accountId), OPTIONS),
    SecureStore.deleteItemAsync(treatmentActionExecutionStorageKey(accountId), OPTIONS),
    SecureStore.deleteItemAsync(treatmentActionPlacementStorageKey(accountId), OPTIONS),
    ...TREATMENT_ACTION_ITEMS.map((definition) =>
      SecureStore.deleteItemAsync(treatmentActionItemStorageKey(accountId, definition.id), OPTIONS)),
  ]);
}
