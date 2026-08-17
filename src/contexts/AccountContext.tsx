import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { AuthUser, AccountState, Entitlements } from '../api/types';
import { supabase } from '../lib/supabase';
import { isAdminEmail } from '../lib/admin';
import { configureRevenueCat, getActiveRevenueCatTier, resetRevenueCatUser } from '../lib/revenueCat';
import {
  AccountRequestGate,
  resolveDirectAccountState,
  resolveRefreshedDirectAccountState,
  withTimeoutFallback,
} from '../lib/authBootstrap';
import { addAppBreadcrumb, captureAppError } from '../lib/monitoring';
import { entitlementsForAccountState } from '../lib/featureAccess';
import {
  cacheSuccessfulAccount,
  clearLastOfflineAccount,
  clearOfflineAccount,
  isOfflineFallbackError,
  restoreLastOfflineAccount,
  restoreOfflineAccount,
} from '../lib/offlineAccountCache';

const DEFAULT_ENTITLEMENTS: Entitlements = entitlementsForAccountState('direct-free');

interface AccountContextValue {
  user: AuthUser | null;
  accountState: AccountState;
  entitlements: Entitlements;
  isLoading: boolean;
  isAuthenticated: boolean;
  accountError: string | null;
  isAttached: boolean;
  isAdmin: boolean;
  isOfflineAccountFallback: boolean;
  refreshAccount: () => Promise<void>;
  completeSignIn: (sessionUser: User) => void;
}

const AccountContext = createContext<AccountContextValue>({
  user: null,
  accountState: 'direct-free',
  entitlements: DEFAULT_ENTITLEMENTS,
  isLoading: true,
  isAuthenticated: false,
  accountError: null,
  isAttached: false,
  isAdmin: false,
  isOfflineAccountFallback: false,
  refreshAccount: async () => {},
  completeSignIn: () => {},
});

async function withRequiredTimeout<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('account_load_timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function fetchCoreAccount(authUser: User): Promise<AuthUser | null> {
  const isAdmin = isAdminEmail(authUser.email);
  const accountResult = await withRequiredTimeout(
    supabase
      .from('accounts')
      .select('id, type, org_id, first_name, last_name, language, timezone, created_at')
      .eq('user_id', authUser.id)
      .single(),
    4000,
  );
  const { data, error } = accountResult;

  if (error || !data) {
    if (!isAdmin || (error && error.code !== 'PGRST116')) {
      throw error ?? new Error('account_not_found');
    }

    return buildAuthUser({
      id: authUser.id,
      firstName: 'Matt',
      lastName: '',
      email: authUser.email ?? '',
      accountState: 'direct-free',
      orgId: null,
      joinedAt: new Date().toISOString(),
      timezone: 'America/Los_Angeles',
      adminOverride: true,
    });
  }

  // Consent persistence is best-effort and must never hold the user on the
  // sign-in screen. The RPC only records affirmative signup metadata.
  void supabase.rpc('record_signup_terms_consent').then(({ error: consentError }) => {
    if (consentError) addAppBreadcrumb('auth.consent_persistence_failed', 'warning');
  });

  let accountState: AccountState = data.type === 'attached' ? 'attached' : 'direct-free';

  if (data.type === 'direct' && !isAdmin) {
    // Database entitlements are immediately available and safe to use for the
    // first render. External subscription reconciliation happens after entry.
    const entitlementResult = await withTimeoutFallback(
      Promise.resolve(
        supabase
          .from('entitlements')
          .select('tier, expires_at')
          .eq('account_id', data.id),
      ),
      1000,
      null,
    );
    if (!entitlementResult || entitlementResult.error) {
      addAppBreadcrumb('auth.entitlements_initial_load_failed', 'warning');
    } else {
      accountState = resolveDirectAccountState(entitlementResult.data ?? []);
    }
  }

  let effectiveTimezone = data.timezone || 'UTC';
  const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (deviceTimezone && deviceTimezone !== data.timezone) {
    const timezoneResult = await withTimeoutFallback(
      Promise.resolve(
        supabase.from('accounts').update({ timezone: deviceTimezone }).eq('id', data.id),
      ),
      1000,
      null,
    );
    if (timezoneResult && !timezoneResult.error) {
      effectiveTimezone = deviceTimezone;
    } else {
      addAppBreadcrumb('auth.timezone_sync_failed', 'warning');
    }
  }

  return buildAuthUser({
    id: data.id,
    firstName: data.first_name ?? '',
    lastName: data.last_name ?? '',
    email: authUser.email ?? '',
    accountState,
    orgId: data.org_id ?? null,
    joinedAt: data.created_at,
    timezone: effectiveTimezone,
    adminOverride: isAdmin,
  });
}

async function enrichAccount(authUser: User, coreAccount: AuthUser): Promise<AuthUser> {
  if (isAdminEmail(authUser.email) || coreAccount.accountState === 'attached') return coreAccount;

  const revenueCatReady = await withTimeoutFallback(configureRevenueCat(coreAccount.id), 2500, false);

  // These bridges repair the server-side entitlement mirror, but they are
  // optional enrichment. A slow provider must never block successful login.
  await withTimeoutFallback(
    Promise.allSettled([
      supabase.functions.invoke('sync-web-membership'),
      supabase.functions.invoke('sync-iap-entitlements'),
    ]).then(() => undefined),
    4000,
    undefined,
  );

  const entitlementResult = await withTimeoutFallback(
    Promise.resolve(
      supabase
        .from('entitlements')
        .select('tier, expires_at')
        .eq('account_id', coreAccount.id),
    ),
    1500,
    null,
  );

  // A successful post-sync database read is authoritative. RevenueCat may be
  // cached on-device, so it must not restore access after the server revoked it.
  // RevenueCat is only a display fallback when the database cannot be read.
  let accountState: AccountState;
  if (entitlementResult && !entitlementResult.error) {
    accountState = resolveRefreshedDirectAccountState({
      databaseRows: entitlementResult.data ?? [],
      previousState: coreAccount.accountState as 'direct-free' | 'direct-essential' | 'direct-premium',
      revenueCatTier: null,
    });
  } else {
    addAppBreadcrumb('auth.entitlements_refresh_failed', 'warning');
    const revenueCatTier = revenueCatReady
      ? await withTimeoutFallback(getActiveRevenueCatTier(), 2500, null)
      : null;
    accountState = resolveRefreshedDirectAccountState({
      databaseRows: null,
      previousState: coreAccount.accountState as 'direct-free' | 'direct-essential' | 'direct-premium',
      revenueCatTier,
    });
  }

  if (accountState === coreAccount.accountState) return coreAccount;
  return buildAuthUser({
    id: coreAccount.id,
    firstName: coreAccount.firstName,
    lastName: coreAccount.lastName,
    email: coreAccount.email,
    accountState,
    orgId: coreAccount.orgId,
    joinedAt: coreAccount.joinedAt,
    timezone: coreAccount.timezone,
  });
}

function buildAuthUser({
  id,
  firstName,
  lastName,
  email,
  accountState,
  orgId,
  joinedAt,
  timezone,
  adminOverride = false,
}: {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  accountState: AccountState;
  orgId: string | null;
  joinedAt: string;
  timezone: string;
  adminOverride?: boolean;
}): AuthUser {
  const entitlements = entitlementsForAccountState(accountState, adminOverride);

  return {
    id,
    firstName,
    lastName,
    email,
    avatarUrl: null,
    accountState,
    entitlements,
    orgId,
    branding: null,
    joinedAt,
    timezone,
  };
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [isOfflineAccountFallback, setIsOfflineAccountFallback] = useState(false);
  const authGenerationRef = useRef(0);
  const accountRequestGateRef = useRef(new AccountRequestGate());
  const authUserRef = useRef<User | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  const isLoadingRef = useRef(true);
  const cacheWriteRef = useRef<Promise<void>>(Promise.resolve());

  const queueAccountCacheWrite = useCallback((authUserId: string, account: AuthUser) => {
    cacheWriteRef.current = cacheWriteRef.current
      .catch(() => undefined)
      .then(() => cacheSuccessfulAccount(authUserId, account))
      .catch(() => {
        addAppBreadcrumb('auth.offline_account_cache_write_failed', 'warning');
      });
  }, []);

  const completeSignIn = useCallback((sessionUser: User) => {
    const previousAuthUserId = authUserRef.current?.id;
    if (
      previousAuthUserId === sessionUser.id &&
      (isLoadingRef.current || userRef.current !== null)
    ) {
      return;
    }

    // Never expose one account's profile or client-side entitlements under a
    // different authenticated session, even briefly.
    if (previousAuthUserId && previousAuthUserId !== sessionUser.id) {
      userRef.current = null;
      setUser(null);
    }

    const generation = ++authGenerationRef.current;
    const requestId = accountRequestGateRef.current.begin();
    authUserRef.current = sessionUser;
    isLoadingRef.current = true;
    setAuthUser(sessionUser);
    setIsLoading(true);
    setAccountError(null);
    setIsOfflineAccountFallback(false);
    addAppBreadcrumb('auth.account_bootstrap_started');

    void fetchCoreAccount(sessionUser)
      .then((account) => {
        if (
          authGenerationRef.current !== generation ||
          !accountRequestGateRef.current.isCurrent(requestId) ||
          !account
        ) return;
        userRef.current = account;
        setUser(account);
        setIsOfflineAccountFallback(false);
        isLoadingRef.current = false;
        setIsLoading(false);
        queueAccountCacheWrite(sessionUser.id, account);
        addAppBreadcrumb('auth.account_bootstrap_completed');

        // Optional subscription providers refresh after app entry. They can
        // improve entitlements, but cannot keep a valid user on the login page.
        void enrichAccount(sessionUser, account)
          .then((enriched) => {
            if (
              authGenerationRef.current !== generation ||
              !accountRequestGateRef.current.isCurrent(requestId)
            ) return;
            userRef.current = enriched;
            setUser(enriched);
            queueAccountCacheWrite(sessionUser.id, enriched);
            addAppBreadcrumb('auth.account_enrichment_completed');
          })
          .catch((error) => {
            if (
              authGenerationRef.current !== generation ||
              !accountRequestGateRef.current.isCurrent(requestId)
            ) return;
            addAppBreadcrumb('auth.account_enrichment_failed', 'warning');
            captureAppError(error);
          });
      })
      .catch(async (error) => {
        if (
          authGenerationRef.current !== generation ||
          !accountRequestGateRef.current.isCurrent(requestId)
        ) return;
        if (isOfflineFallbackError(error)) {
          const cached = await restoreOfflineAccount(sessionUser.id);
          if (
            cached
            && authGenerationRef.current === generation
            && accountRequestGateRef.current.isCurrent(requestId)
            && authUserRef.current?.id === sessionUser.id
          ) {
            userRef.current = cached;
            setUser(cached);
            isLoadingRef.current = false;
            setIsLoading(false);
            setIsOfflineAccountFallback(true);
            setAccountError(null);
            addAppBreadcrumb('auth.offline_account_fallback_restored', 'warning');
            return;
          }
        }
        isLoadingRef.current = false;
        setIsLoading(false);
        setIsOfflineAccountFallback(false);
        setAccountError(error instanceof Error ? error.message : 'account_load_failed');
        addAppBreadcrumb('auth.account_bootstrap_failed', 'error');
        captureAppError(error);
      });
  }, [queueAccountCacheWrite]);

  const refreshAccount = useCallback(async () => {
    const currentAuthUser = authUserRef.current;
    if (!currentAuthUser) return;
    const generation = authGenerationRef.current;
    const requestId = accountRequestGateRef.current.begin();
    setAccountError(null);
    if (!userRef.current) {
      isLoadingRef.current = true;
      setIsLoading(true);
    }
    try {
      const account = await fetchCoreAccount(currentAuthUser);
      if (
        authGenerationRef.current !== generation ||
        !accountRequestGateRef.current.isCurrent(requestId) ||
        !account
      ) return;
      userRef.current = account;
      setUser(account);
      setIsOfflineAccountFallback(false);
      isLoadingRef.current = false;
      setIsLoading(false);
      queueAccountCacheWrite(currentAuthUser.id, account);
      const enriched = await enrichAccount(currentAuthUser, account);
      if (
        authGenerationRef.current === generation &&
        accountRequestGateRef.current.isCurrent(requestId)
      ) {
        userRef.current = enriched;
        setUser(enriched);
        queueAccountCacheWrite(currentAuthUser.id, enriched);
      }
    } catch (error) {
      if (
        authGenerationRef.current === generation &&
        accountRequestGateRef.current.isCurrent(requestId)
      ) {
        if (isOfflineFallbackError(error)) {
          const cached = await restoreOfflineAccount(currentAuthUser.id);
          if (
            cached
            && authGenerationRef.current === generation
            && accountRequestGateRef.current.isCurrent(requestId)
            && authUserRef.current?.id === currentAuthUser.id
          ) {
            userRef.current = cached;
            setUser(cached);
            isLoadingRef.current = false;
            setIsLoading(false);
            setIsOfflineAccountFallback(true);
            setAccountError(null);
            addAppBreadcrumb('auth.offline_account_fallback_restored', 'warning');
            return;
          }
        }
        isLoadingRef.current = false;
        setIsLoading(false);
        setIsOfflineAccountFallback(false);
        setAccountError(error instanceof Error ? error.message : 'account_load_failed');
        captureAppError(error);
      }
      throw error;
    }
  }, [queueAccountCacheWrite]);

  useEffect(() => {
    const initialGeneration = authGenerationRef.current;

    const restoreAfterRetryableSessionFailure = async (error: unknown) => {
      if (!isOfflineFallbackError(error) || authGenerationRef.current !== initialGeneration) return false;
      const cached = await restoreLastOfflineAccount();
      if (!cached || authGenerationRef.current !== initialGeneration) return false;
      userRef.current = cached;
      isLoadingRef.current = false;
      setUser(cached);
      setIsOfflineAccountFallback(true);
      setAccountError(null);
      setIsLoading(false);
      addAppBreadcrumb('auth.offline_session_fallback_restored', 'warning');
      return true;
    };

    void supabase.auth.getSession()
      .then(async ({ data: { session }, error }) => {
        if (authGenerationRef.current !== initialGeneration) return;
        if (session) {
          completeSignIn(session.user);
          return;
        }
        if (error && await restoreAfterRetryableSessionFailure(error)) return;
        isLoadingRef.current = false;
        setIsLoading(false);
      })
      .catch(async (error) => {
        if (await restoreAfterRetryableSessionFailure(error)) return;
        if (authGenerationRef.current === initialGeneration) {
          isLoadingRef.current = false;
          setIsLoading(false);
          setAccountError(error instanceof Error ? error.message : 'session_load_failed');
        }
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        completeSignIn(session.user);
      } else if (event === 'SIGNED_OUT') {
        const signedOutAuthUserId = authUserRef.current?.id;
        ++authGenerationRef.current;
        accountRequestGateRef.current.invalidate();
        authUserRef.current = null;
        userRef.current = null;
        isLoadingRef.current = false;
        setAuthUser(null);
        setUser(null);
        setAccountError(null);
        setIsOfflineAccountFallback(false);
        setIsLoading(false);
        // Finish any older write before clearing so logout cannot race a stale
        // profile back onto disk.
        cacheWriteRef.current = cacheWriteRef.current
          .catch(() => undefined)
          .then(() => signedOutAuthUserId
            ? clearOfflineAccount(signedOutAuthUserId)
            : clearLastOfflineAccount())
          .catch(() => {
            addAppBreadcrumb('auth.offline_account_cache_clear_failed', 'warning');
          });
        void resetRevenueCatUser();
      }
    });

    return () => subscription.unsubscribe();
  }, [completeSignIn]);

  const accountState = user?.accountState ?? 'direct-free';
  const entitlements = user?.entitlements ?? DEFAULT_ENTITLEMENTS;

  return (
    <AccountContext.Provider
      value={{
        user,
        accountState,
        entitlements,
        isLoading,
        isAuthenticated: authUser !== null || (isOfflineAccountFallback && user !== null),
        accountError,
        isAttached: accountState === 'attached',
        // Admin is an online QA bypass, never an offline authorization cache.
        isAdmin: !isOfflineAccountFallback && isAdminEmail(authUser?.email),
        isOfflineAccountFallback,
        refreshAccount,
        completeSignIn,
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  return useContext(AccountContext);
}
