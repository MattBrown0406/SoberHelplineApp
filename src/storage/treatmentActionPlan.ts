import * as SecureStore from 'expo-secure-store';
import {
  parseTreatmentActionPlan,
  TREATMENT_ACTION_ITEMS,
  type TreatmentActionExecution,
  type TreatmentActionItemId,
  type TreatmentActionItemState,
  type TreatmentActionPlan,
} from '../lib/treatmentActionPlan';
import {
  treatmentActionExecutionStorageKey,
  treatmentActionItemStorageKey,
  treatmentActionMetaStorageKey,
} from '../lib/treatmentActionStorageKeys';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

async function requireProtectedStorage(): Promise<void> {
  if (!(await SecureStore.isAvailableAsync())) {
    throw new Error('protected_storage_unavailable');
  }
}

export async function loadProtectedTreatmentActionPlan(accountId: string): Promise<TreatmentActionPlan> {
  await requireProtectedStorage();
  const [metaRaw, executionRaw, ...itemRows] = await Promise.all([
    SecureStore.getItemAsync(treatmentActionMetaStorageKey(accountId), OPTIONS),
    SecureStore.getItemAsync(treatmentActionExecutionStorageKey(accountId), OPTIONS),
    ...TREATMENT_ACTION_ITEMS.map((definition) =>
      SecureStore.getItemAsync(treatmentActionItemStorageKey(accountId, definition.id), OPTIONS)),
  ]);

  const items: Record<string, unknown> = {};
  TREATMENT_ACTION_ITEMS.forEach((definition, index) => {
    const raw = itemRows[index];
    if (!raw) return;
    try {
      items[definition.id] = JSON.parse(raw) as unknown;
    } catch {
      items[definition.id] = null;
    }
  });

  let updatedAt: unknown = null;
  if (metaRaw) {
    try {
      const meta = JSON.parse(metaRaw) as { updatedAt?: unknown };
      updatedAt = meta.updatedAt;
    } catch {
      updatedAt = null;
    }
  }
  let execution: unknown = null;
  if (executionRaw) {
    try {
      execution = JSON.parse(executionRaw) as unknown;
    } catch {
      execution = null;
    }
  }
  return parseTreatmentActionPlan(JSON.stringify({ items, execution, updatedAt }));
}

export async function saveProtectedTreatmentActionItem(
  accountId: string,
  id: TreatmentActionItemId,
  item: TreatmentActionItemState,
  updatedAt: string | null,
): Promise<void> {
  await requireProtectedStorage();
  await SecureStore.setItemAsync(treatmentActionItemStorageKey(accountId, id), JSON.stringify(item), OPTIONS);
  await SecureStore.setItemAsync(treatmentActionMetaStorageKey(accountId), JSON.stringify({ updatedAt }), OPTIONS);
}

export async function saveProtectedTreatmentActionExecution(
  accountId: string,
  execution: TreatmentActionExecution,
  updatedAt: string | null,
): Promise<void> {
  await requireProtectedStorage();
  await SecureStore.setItemAsync(
    treatmentActionExecutionStorageKey(accountId),
    JSON.stringify(execution),
    OPTIONS,
  );
  await SecureStore.setItemAsync(treatmentActionMetaStorageKey(accountId), JSON.stringify({ updatedAt }), OPTIONS);
}

export async function clearProtectedTreatmentActionPlan(accountId: string): Promise<void> {
  await requireProtectedStorage();
  await Promise.all([
    SecureStore.deleteItemAsync(treatmentActionMetaStorageKey(accountId), OPTIONS),
    SecureStore.deleteItemAsync(treatmentActionExecutionStorageKey(accountId), OPTIONS),
    ...TREATMENT_ACTION_ITEMS.map((definition) =>
      SecureStore.deleteItemAsync(treatmentActionItemStorageKey(accountId, definition.id), OPTIONS)),
  ]);
}
