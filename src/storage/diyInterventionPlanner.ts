import * as SecureStore from 'expo-secure-store';
import type { DiyInterventionPlan } from '../lib/diyInterventionPlanner';
import {
  DIY_CURRENT_PROTECTED_PARTS,
  DIY_PROTECTED_PARTS,
  diyInterventionCommitStorageKey,
  diyInterventionSlotStorageKey,
  diyInterventionStorageKey,
  type DiyCurrentProtectedPart,
  type DiyProtectedPart,
  type DiyProtectedSlot,
} from '../lib/diyInterventionStorageKeys';
import {
  parseCurrentDiyProtectedParts,
  parseDiyProtectedParts,
  serializeDiyProtectedParts,
} from '../lib/diyInterventionProtectedRecord';

const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

async function requireProtectedStorage(): Promise<void> {
  if (!(await SecureStore.isAvailableAsync())) throw new Error('protected_storage_unavailable');
}

async function awaitEvery(operations: Promise<void>[]): Promise<void> {
  const results = await Promise.allSettled(operations);
  const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failure) throw failure.reason;
}

function parseCommittedSlot(raw: string | null): DiyProtectedSlot | null {
  if (raw === null) return null;
  if (raw !== 'a' && raw !== 'b') throw new Error('protected_diy_invalid_commit_pointer');
  return raw;
}

async function readCurrentSlot(accountId: string, slot: DiyProtectedSlot): Promise<DiyInterventionPlan> {
  const values = await Promise.all(DIY_CURRENT_PROTECTED_PARTS.map((part) =>
    SecureStore.getItemAsync(diyInterventionSlotStorageKey(accountId, slot, part), OPTIONS)));
  const records = Object.fromEntries(DIY_CURRENT_PROTECTED_PARTS.map((part, index) => [part, values[index]])) as Record<DiyCurrentProtectedPart, string | null>;
  return parseCurrentDiyProtectedParts(records);
}

async function readLegacy(accountId: string): Promise<DiyInterventionPlan> {
  const values = await Promise.all(DIY_PROTECTED_PARTS.map((part) =>
    SecureStore.getItemAsync(diyInterventionStorageKey(accountId, part), OPTIONS)));
  const records = Object.fromEntries(DIY_PROTECTED_PARTS.map((part, index) => [part, values[index]])) as Record<DiyProtectedPart, string | null>;
  return parseDiyProtectedParts(records);
}

export async function loadProtectedDiyInterventionPlan(accountId: string): Promise<DiyInterventionPlan> {
  await requireProtectedStorage();
  const committed = parseCommittedSlot(await SecureStore.getItemAsync(diyInterventionCommitStorageKey(accountId), OPTIONS));
  return committed ? readCurrentSlot(accountId, committed) : readLegacy(accountId);
}

export async function saveProtectedDiyInterventionPlan(accountId: string, plan: DiyInterventionPlan): Promise<void> {
  await requireProtectedStorage();
  const committed = parseCommittedSlot(await SecureStore.getItemAsync(diyInterventionCommitStorageKey(accountId), OPTIONS));
  const target: DiyProtectedSlot = committed === 'a' ? 'b' : 'a';
  const records = serializeDiyProtectedParts(plan);
  // Verify the complete candidate before touching protected storage.
  parseCurrentDiyProtectedParts(records);
  await awaitEvery(DIY_CURRENT_PROTECTED_PARTS.map((part) =>
    SecureStore.setItemAsync(diyInterventionSlotStorageKey(accountId, target, part), records[part], OPTIONS)));
  // The prior coherent slot remains authoritative until this single commit point succeeds.
  await SecureStore.setItemAsync(diyInterventionCommitStorageKey(accountId), target, OPTIONS);
}

export async function clearProtectedDiyInterventionPlan(accountId: string): Promise<void> {
  await requireProtectedStorage();
  const dataDeletes: Promise<void>[] = [
    ...DIY_PROTECTED_PARTS.map((part) => SecureStore.deleteItemAsync(diyInterventionStorageKey(accountId, part), OPTIONS)),
    ...(['a', 'b'] as const).flatMap((slot) => DIY_CURRENT_PROTECTED_PARTS.map((part) =>
      SecureStore.deleteItemAsync(diyInterventionSlotStorageKey(accountId, slot, part), OPTIONS))),
  ];
  // Keep the commit pointer until every data deletion succeeds. A partial clear
  // therefore reloads as blocking corruption rather than an apparently empty plan.
  await awaitEvery(dataDeletes);
  await SecureStore.deleteItemAsync(diyInterventionCommitStorageKey(accountId), OPTIONS);
}
