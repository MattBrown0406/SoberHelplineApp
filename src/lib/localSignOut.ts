import type { OutboxItem, OutboxKind } from './offlineOutbox';

/**
 * Signing out while offline.
 *
 * `supabase.auth.signOut()` always calls the server first and, when that call
 * fails for a network reason, leaves the local session in place. A member with
 * no signal would be stuck signed in on a shared or borrowed phone. This module
 * signs out the device alone, after the member has been told what that costs:
 * queued offline check-ins and journal notes for the account are discarded, and
 * the server-side push token is revoked later (see pendingPushTokenRevoke).
 */

export interface LocalSignOutDeps {
  /** Remove the auth session from this device (and emit SIGNED_OUT). Must not need the network. */
  removeSession: () => Promise<void>;
  /** Record that the account's server-side push token still needs revoking. */
  storePendingRevoke: (accountId: string) => Promise<void>;
  /** Drop the account's queued offline writes. */
  discardOutbox: (accountId: string) => Promise<void>;
  /** Wipe the cached profile used for offline sign-in (last principal when the id is unknown). */
  clearOfflineAccount: (authUserId: string | null) => Promise<void>;
}

export interface LocalSignOutTarget {
  accountId: string;
  /** Null when the session was itself restored from the offline cache. */
  authUserId: string | null;
}

/**
 * Order matters: the revoke intent is written first so it survives even if a
 * later step throws, and the session is removed last so nothing can be
 * replayed or re-cached for the account after the device forgets it.
 */
export async function signOutLocally(target: LocalSignOutTarget, deps: LocalSignOutDeps): Promise<void> {
  await deps.storePendingRevoke(target.accountId);
  await deps.discardOutbox(target.accountId);
  await deps.clearOfflineAccount(target.authUserId);
  await deps.removeSession();
}

export type OutboxImpact = Record<OutboxKind, number>;

/** How many queued writes of each kind a local sign-out would discard. */
export function outboxImpact(items: readonly OutboxItem[]): OutboxImpact {
  const impact: OutboxImpact = { checkin: 0, journal: 0 };
  for (const item of items) impact[item.kind] += 1;
  return impact;
}

export function hasOutboxImpact(impact: OutboxImpact): boolean {
  return impact.checkin > 0 || impact.journal > 0;
}

/**
 * auth-js exposes no public "forget the session without the network" call, but
 * its own signOut() finishes with `_removeSession()`, which clears storage and
 * memory and notifies SIGNED_OUT. Use that when present; otherwise fall back to
 * the public local sign-out (which still needs the server to answer).
 * tests/local-sign-out.test.ts pins the installed auth-js to this behaviour.
 */
export interface LocalSessionAuth {
  signOut(options: { scope: 'local' }): Promise<{ error: unknown }>;
}

export async function removeSessionLocally(auth: LocalSessionAuth): Promise<void> {
  const internal = auth as { _removeSession?: () => Promise<void> };
  if (typeof internal._removeSession === 'function') {
    await internal._removeSession();
    return;
  }
  const { error } = await auth.signOut({ scope: 'local' });
  if (error) throw error;
}
