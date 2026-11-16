import Purchases, { type PurchasesPackage } from 'react-native-purchases';
import { RC_API_KEY as revenueCatPublicKey } from '../config';

let configured = false;
let identityQueue: Promise<void> = Promise.resolve();

function ensureConfigured() {
  if (configured) return;
  if (!revenueCatPublicKey) {
    throw new Error('RevenueCat is not configured for this platform');
  }
  Purchases.configure({ apiKey: revenueCatPublicKey });
  configured = true;
}

function serializeIdentity<T>(operation: () => Promise<T>): Promise<T> {
  const result = identityQueue.catch(() => undefined).then(operation);
  identityQueue = result.then(() => undefined, () => undefined);
  return result;
}

/**
 * Puts RevenueCat on this account: the one login call, used at sign-in and,
 * when that one failed (a bad network), once more just before a purchase.
 * Only ever called inside the identity queue.
 */
async function identifyAs(userId: string): Promise<void> {
  const currentUserId = await Purchases.getAppUserID();
  if (currentUserId === userId) return;
  if (!currentUserId.startsWith('$RCAnonymousID:')) await Purchases.logOut();
  await Purchases.logIn(userId);
}

/** Configure RevenueCat and finish customer identification before entitlement reads. */
export function configureRevenueCat(userId?: string): Promise<boolean> {
  // Web billing is optional. If no key is configured for the active platform,
  // leave RevenueCat disabled instead of invoking its SDK with another
  // platform's key and producing a guaranteed configuration failure.
  if (!revenueCatPublicKey) return Promise.resolve(false);
  return serializeIdentity(async () => {
    try {
      ensureConfigured();
      if (userId) await identifyAs(userId);
      return true;
    } catch (err) {
      console.warn('[RevenueCat] configure/login failed:', err);
      return false;
    }
  });
}

/** Prevent one Supabase account from inheriting another account's RC identity. */
export function resetRevenueCatUser(): Promise<void> {
  if (!revenueCatPublicKey) return Promise.resolve();
  return serializeIdentity(async () => {
    try {
      ensureConfigured();
      const currentUserId = await Purchases.getAppUserID();
      if (!currentUserId.startsWith('$RCAnonymousID:')) await Purchases.logOut();
    } catch (err) {
      console.warn('[RevenueCat] logOut failed:', err);
    }
  });
}

/** Thrown when she left (or the screen or account changed) before the store was asked: nothing was bought. */
export const PURCHASE_NOT_STARTED = 'purchase_session_changed';

/**
 * Thrown when RevenueCat is not on this account and could not be put on it:
 * nothing was bought, and the purchase cannot start. Unlike PURCHASE_NOT_STARTED
 * this is a failure she must be told about (otherwise Subscribe does nothing,
 * every time, with no word why).
 */
export const PURCHASE_NOT_IDENTIFIED = 'purchase_identity_unconfirmed';

export interface PurchaseStartOptions {
  /** Called at the moment the store's own purchase call is made, and not before. */
  onStoreCall?: () => void;
  /**
   * Asked before RevenueCat is moved onto `expectedOwner`: true only when the
   * signed-in account is still that one. Without it RevenueCat is never moved.
   */
  confirmOwner?: () => Promise<boolean>;
}

/**
 * `mayStart` is asked only BEFORE the store is called. Once the store has
 * answered, the result is always returned: the purchase was made as
 * `expectedOwner` (identity changes wait in the same queue), and dropping it
 * because the screen has gone would leave her charged but still "free".
 *
 * When RevenueCat is on another customer (its login failed at sign-in), it is
 * identified once here, with the same login call, and the purchase goes on if
 * that worked. It never buys as anyone but `expectedOwner`.
 */
export function purchaseRevenueCatPackage(
  pkg: PurchasesPackage,
  expectedOwner: string,
  mayStart: () => boolean,
  options: PurchaseStartOptions = {},
) {
  return serializeIdentity(async () => {
    if (!expectedOwner || !mayStart()) throw new Error(PURCHASE_NOT_STARTED);
    let owner = await Purchases.getAppUserID();
    if (!mayStart()) throw new Error(PURCHASE_NOT_STARTED);
    if (owner !== expectedOwner) {
      // Only for the account that is really signed in: never on a guess.
      const confirmed = options.confirmOwner
        ? await options.confirmOwner().catch(() => false)
        : false;
      if (!mayStart()) throw new Error(PURCHASE_NOT_STARTED);
      if (!confirmed) throw new Error(PURCHASE_NOT_IDENTIFIED);
      try {
        await identifyAs(expectedOwner);
        owner = await Purchases.getAppUserID();
      } catch (err) {
        console.warn('[RevenueCat] login before purchase failed:', err);
        throw new Error(PURCHASE_NOT_IDENTIFIED);
      }
      // She may have left while it was logging in.
      if (!mayStart()) throw new Error(PURCHASE_NOT_STARTED);
      if (owner !== expectedOwner) throw new Error(PURCHASE_NOT_IDENTIFIED);
    }
    // From here the store is involved. (Nothing may come between the check
    // above and this call: the caller locks the screen on `onStoreCall`.)
    options.onStoreCall?.();
    return Purchases.purchasePackage(pkg);
  });
}

export function getActiveRevenueCatTier(): Promise<'premium' | 'essential' | null> {
  return serializeIdentity(async () => {
    try {
      const info = await Purchases.getCustomerInfo();
      if (info.entitlements.active.premium) return 'premium';
      if (info.entitlements.active.essential) return 'essential';
      return null;
    } catch {
      return null;
    }
  });
}

export async function getIsActivePremium(): Promise<boolean> {
  return (await getActiveRevenueCatTier()) === 'premium';
}

export async function getIsActiveEssential(): Promise<boolean> {
  return (await getActiveRevenueCatTier()) === 'essential';
}

/** Restore purchases only after all pending identity changes finish. */
export function restorePurchases(): Promise<boolean> {
  return serializeIdentity(async () => {
    const info = await Purchases.restorePurchases();
    return Boolean(info.entitlements.active.premium || info.entitlements.active.essential);
  });
}
