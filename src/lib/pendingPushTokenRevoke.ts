import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * When a member signs out while offline, the server still holds this device's
 * push token for their account. We record the intent to revoke it here and
 * settle it the next time that account has a working session, before the
 * device re-registers.
 */
export const PENDING_PUSH_TOKEN_REVOKE_KEY = '@sober-helpline/pending-push-token-revoke/v1';

export interface PendingPushTokenRevoke {
  version: 1;
  accountId: string;
  requestedAt: string;
}

export interface PendingRevokeStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export type SettlePendingRevokeResult = 'none' | 'revoked' | 'retry' | 'superseded';

export function isPendingPushTokenRevoke(value: unknown): value is PendingPushTokenRevoke {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1
    && typeof record.accountId === 'string' && record.accountId.length > 0
    && typeof record.requestedAt === 'string';
}

export async function storePendingPushTokenRevoke(
  accountId: string,
  storage: PendingRevokeStorage = AsyncStorage,
  now: () => string = () => new Date().toISOString(),
): Promise<void> {
  const record: PendingPushTokenRevoke = { version: 1, accountId, requestedAt: now() };
  await storage.setItem(PENDING_PUSH_TOKEN_REVOKE_KEY, JSON.stringify(record));
}

/** Fails closed: anything unreadable is discarded rather than acted on. */
export async function readPendingPushTokenRevoke(
  storage: PendingRevokeStorage = AsyncStorage,
): Promise<PendingPushTokenRevoke | null> {
  const raw = await storage.getItem(PENDING_PUSH_TOKEN_REVOKE_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isPendingPushTokenRevoke(parsed)) return parsed;
  } catch {
    // fall through to removal
  }
  await storage.removeItem(PENDING_PUSH_TOKEN_REVOKE_KEY);
  return null;
}

export async function clearPendingPushTokenRevoke(
  storage: PendingRevokeStorage = AsyncStorage,
): Promise<void> {
  await storage.removeItem(PENDING_PUSH_TOKEN_REVOKE_KEY);
}

/**
 * Call once a session for `accountId` is live, before registering the device.
 *
 * - Same account: run `revoke` (null the server-side token); the record is
 *   kept for another attempt if that fails.
 * - Different account: the record is dropped — `register_push_device` moves
 *   the device token to the new owner in one server transaction, so the old
 *   account cannot keep it.
 */
export async function settlePendingPushTokenRevoke(
  accountId: string,
  revoke: (accountId: string) => Promise<void>,
  storage: PendingRevokeStorage = AsyncStorage,
): Promise<SettlePendingRevokeResult> {
  const pending = await readPendingPushTokenRevoke(storage);
  if (!pending) return 'none';
  if (pending.accountId !== accountId) {
    await clearPendingPushTokenRevoke(storage);
    return 'superseded';
  }
  try {
    await revoke(accountId);
  } catch {
    return 'retry';
  }
  await clearPendingPushTokenRevoke(storage);
  return 'revoked';
}
