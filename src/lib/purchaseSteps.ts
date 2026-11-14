/**
 * The steps of a purchase that happen BEFORE the store is asked to sell
 * anything: reading the session, loading the store's products, confirming who
 * RevenueCat thinks she is. Nothing has been charged during them, so:
 * - each one has a time limit (a stalled connection must not hold the screen);
 * - she may leave during them, and leaving ends the attempt at once.
 * Once the store's own purchase call has been made neither applies: its answer
 * is always waited for.
 *
 * Pure (no device imports), so it runs in unit tests.
 */

/** About how long each step before the store's purchase call may take. */
export const PRE_STORE_STEP_MS = 15_000;

export type PreStoreStep<T> =
  | { outcome: 'done'; value: T }
  /** The step took too long: stop with the normal purchase-error message. */
  | { outcome: 'timeout' }
  /** She closed the sheet or left the screen: stop quietly. */
  | { outcome: 'left' };

/**
 * Waits for one pre-store step, but no longer than `limitMs`, and no longer
 * than she stays. `onStop` runs the instant the wait is given up (before
 * anything else can run), so the caller can make sure the abandoned work
 * starts nothing later. A step that fails rejects as it always did.
 */
export function beforeStoreStep<T>(
  work: PromiseLike<T>,
  options: { limitMs?: number; left?: Promise<void>; onStop?: (why: 'timeout' | 'left') => void } = {},
): Promise<PreStoreStep<T>> {
  return new Promise<PreStoreStep<T>>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (step: PreStoreStep<T>) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (step.outcome !== 'done') {
        try {
          options.onStop?.(step.outcome);
        } catch {
          // Stopping must never fail the stop itself.
        }
      }
      resolve(step);
    };
    timer = setTimeout(() => finish({ outcome: 'timeout' }), options.limitMs ?? PRE_STORE_STEP_MS);
    void options.left?.then(() => finish({ outcome: 'left' }));
    Promise.resolve(work).then(
      (value) => finish({ outcome: 'done', value }),
      (error) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** One tap on a buy button, from the tap until the store is asked (or she leaves first). */
export interface PurchaseAttempt {
  /** True once she closed the sheet or left the screen before the store was asked. */
  left: boolean;
  /** Resolves at that moment, so a step that is waiting can stop at once. */
  whenLeft: Promise<void>;
  leave: () => void;
}

export function newPurchaseAttempt(): PurchaseAttempt {
  let resolveLeft: () => void = () => undefined;
  const attempt: PurchaseAttempt = {
    left: false,
    whenLeft: new Promise<void>((resolve) => { resolveLeft = resolve; }),
    leave: () => {
      if (attempt.left) return;
      attempt.left = true;
      resolveLeft();
    },
  };
  return attempt;
}

/**
 * What the buy flow tells the purchase code: whether it may still start, when
 * she leaves, when the store is actually asked, and how to confirm the
 * signed-in account before RevenueCat is put back on it.
 */
export interface PurchaseControl {
  /** False once she has left: nothing may be started. */
  mayStart?: () => boolean;
  /** Resolves when she leaves before the store is asked. */
  left?: Promise<void>;
  /** Called at the moment the store's own purchase call is made. */
  onStoreCall?: () => void;
  /** True when the signed-in account is still the one that tapped. */
  confirmOwner?: () => Promise<boolean>;
}
