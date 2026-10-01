// expo-secure-store has no web implementation: isAvailableAsync() is false
// and every read throws, so the Treatment Action, Visitation, Homecoming and
// DIY plans could never load in a browser. On web those plans fall back to
// sessionStorage — scoped to this tab and cleared when it closes — and the
// screens say so. Native keeps the protected (Keychain/Keystore) store.

/** The subset of expo-secure-store the plan storage modules use. */
export type ProtectedPlanStore = {
  isAvailableAsync(): Promise<boolean>;
  getItemAsync(key: string, options?: unknown): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: unknown): Promise<void>;
  deleteItemAsync(key: string, options?: unknown): Promise<void>;
};

type WebStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export const WEB_SESSION_PLAN_PREFIX = 'shl.session-plan.';

/** sessionStorage when the browser allows it (it can throw in private modes). */
export function browserSessionStorage(scope: unknown): WebStorage | null {
  try {
    const storage = (scope as { sessionStorage?: WebStorage } | null)?.sessionStorage;
    if (!storage) return null;
    const probe = `${WEB_SESSION_PLAN_PREFIX}probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/** A SecureStore-shaped store over sessionStorage. Unavailable without one. */
export function sessionPlanStore(storage: WebStorage | null): ProtectedPlanStore {
  const required = (): WebStorage => {
    if (!storage) throw new Error('protected_storage_unavailable');
    return storage;
  };
  return {
    isAvailableAsync: async () => storage !== null,
    getItemAsync: async (key) => required().getItem(WEB_SESSION_PLAN_PREFIX + key),
    setItemAsync: async (key, value) => { required().setItem(WEB_SESSION_PLAN_PREFIX + key, value); },
    deleteItemAsync: async (key) => { required().removeItem(WEB_SESSION_PLAN_PREFIX + key); },
  };
}

/** Plans on web live only for the browser session; screens show a notice. */
export function isSessionOnlyPlanStorage(platformOS: string): boolean {
  return platformOS === 'web';
}

/** The store a plan module should use on this platform. */
export function choosePlanStore(platformOS: string, native: ProtectedPlanStore, scope: unknown): ProtectedPlanStore {
  return isSessionOnlyPlanStorage(platformOS) ? sessionPlanStore(browserSessionStorage(scope)) : native;
}
