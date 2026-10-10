import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { User } from '@supabase/supabase-js';
import type { AuthUser, AccountState, Entitlements } from '../api/types';
import i18n from 'i18next';
import { supabase } from '../lib/supabase';
import { isAdminEmail } from '../lib/admin';
import { configureRevenueCat, getActiveRevenueCatTier, resetRevenueCatUser } from '../lib/revenueCat';
import {
  AccountRequestGate,
  accountReadRetryDelay,
  directStateAfterEntitlementRead,
  lastKnownDirectState,
  resolveRefreshedDirectAccountState,
  withTimeoutFallback,
  withVerifiedPurchase,
} from '../lib/authBootstrap';
import { addAppBreadcrumb, captureAppError } from '../lib/monitoring';
import { entitlementsForAccountState } from '../lib/featureAccess';
import {
  cacheSuccessfulAccount,
  clearLastOfflineAccount,
  clearOfflineAccount,
  isOfflineFallbackError,
  readCachedAccountState,
  restoreLastOfflineAccount,
  restoreOfflineAccount,
} from '../lib/offlineAccountCache';
import { offlineOutbox } from '../lib/offlineOutbox';
import { removeSessionLocally, signOutLocally as signOutDeviceLocally } from '../lib/localSignOut';
import { storePendingPushTokenRevoke } from '../lib/pendingPushTokenRevoke';
import { setDeviceSignedIn, stopDevicePushDelivery } from '../lib/pushDevice';

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
  /**
   * False while sign-in's subscription enrichment (RevenueCat / store bridges)
   * may still upgrade the first-render entitlements, which fall back to
   * direct-free when the 1s entitlement read is slow. Gated push routing
   * waits for this so a cold-start tap is not routed with free-tier access.
   */
  entitlementsSettled: boolean;
  refreshAccount: () => Promise<void>;
  completeSignIn: (sessionUser: User) => void;
  /**
   * Sign this device out without the server: discards the account's queued
   * offline writes and cached profile and leaves the push-token revoke pending.
   * Only for when the normal sign-out cannot reach the server.
   */
  signOutLocally: () => Promise<void>;
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
  entitlementsSettled: true,
  refreshAccount: async () => {},
  completeSignIn: () => {},
  signOutLocally: async () => {},
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

/**
 * One account read. `verified`: the tier came from a successful entitlements
 * read (or needs none), so it may be cached. `readFailed`: the latest
 * entitlements read failed or timed out, so the account is re-read later.
 */
type AccountLoad = { account: AuthUser; verified: boolean; readFailed: boolean };

/** The tier this same account last had, used only when an entitlements read fails. */
type LastKnownAccountState = (accountId: string) => Promise<string | null>;

async function fetchCoreAccount(authUser: User, lastKnownState: LastKnownAccountState): Promise<AccountLoad> {
  const isAdmin = isAdminEmail(authUser.email);
  const accountResult = await withRequiredTimeout(
    supabase
      .from('accounts')
      .select('id, type, org_id, first_name, last_name, language, locale, timezone, created_at')
      .eq('user_id', authUser.id)
      .single(),
    4000,
  );
  const { data, error } = accountResult;

  if (error || !data) {
    if (!isAdmin || (error && error.code !== 'PGRST116')) {
      throw error ?? new Error('account_not_found');
    }

    return {
      account: buildAuthUser({
        id: authUser.id,
        firstName: 'Matt',
        lastName: '',
        email: authUser.email ?? '',
        accountState: 'direct-free',
        orgId: null,
        joinedAt: new Date().toISOString(),
        timezone: 'America/Los_Angeles',
        adminOverride: true,
      }),
      verified: true,
      readFailed: false,
    };
  }

  // Consent persistence is best-effort and must never hold the user on the
  // sign-in screen. The RPC only records affirmative signup metadata.
  void supabase.rpc('record_signup_terms_consent').then(({ error: consentError }) => {
    if (consentError) addAppBreadcrumb('auth.consent_persistence_failed', 'warning');
  });

  // A suspended provider no longer grants access; show the tier the server
  // enforces. If the check can't answer quickly, keep the attached view — the
  // server still refuses anything the provider no longer covers.
  let providerActive = data.type === 'attached';
  if (data.type === 'attached' && !isAdmin) {
    const providerResult = await withTimeoutFallback(
      Promise.resolve(supabase.rpc('my_provider_access_active')),
      1000,
      null,
    );
    providerActive = !providerResult || !!providerResult.error || providerResult.data !== false;
  }

  let accountState: AccountState = providerActive ? 'attached' : 'direct-free';
  let verified = true;
  let readFailed = false;

  if (!providerActive && !isAdmin) {
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
    readFailed = !entitlementResult || !!entitlementResult.error;
    if (readFailed) addAppBreadcrumb('auth.entitlements_initial_load_failed', 'warning');
    // A slow or failed read never downgrades a paying member to free.
    const settled = directStateAfterEntitlementRead({
      rows: readFailed ? null : entitlementResult?.data ?? [],
      lastKnownState: readFailed ? await lastKnownState(data.id) : null,
    });
    accountState = settled.state;
    verified = settled.verified;
  }

  // accounts.locale decides which Monday call the server shows (The Family Squares
  // in English, La Sobremesa in Spanish) and the language of server pushes. Sync it
  // before the account resolves so no screen fetches with a stale language.
  const uiLocale = (i18n.language ?? '').startsWith('es') ? 'es' : 'en';
  if (i18n.isInitialized && (data as { locale?: string | null }).locale !== uiLocale) {
    try {
      await withTimeoutFallback(
        Promise.resolve(supabase.from('accounts').update({ locale: uiLocale }).eq('id', data.id)),
        1000,
        null,
      );
    } catch {
      addAppBreadcrumb('auth.locale_sync_failed', 'warning');
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

  return {
    account: buildAuthUser({
      id: data.id,
      firstName: data.first_name ?? '',
      lastName: data.last_name ?? '',
      email: authUser.email ?? '',
      accountState,
      orgId: data.org_id ?? null,
      joinedAt: data.created_at,
      timezone: effectiveTimezone,
      adminOverride: isAdmin,
    }),
    verified,
    readFailed,
  };
}

async function enrichAccount(authUser: User, core: AccountLoad): Promise<AccountLoad> {
  const coreAccount = core.account;
  if (isAdminEmail(authUser.email) || coreAccount.accountState === 'attached') return core;

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
  let verified: boolean;
  const readFailed = !entitlementResult || !!entitlementResult.error;
  if (!readFailed) {
    accountState = resolveRefreshedDirectAccountState({
      databaseRows: entitlementResult?.data ?? [],
      previousState: coreAccount.accountState as 'direct-free' | 'direct-essential' | 'direct-premium',
      revenueCatTier: null,
    });
    verified = true;
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
    // RevenueCat may be cached on-device: a tier it adds is shown, not cached.
    verified = core.verified && accountState === coreAccount.accountState;
  }

  accountState = withVerifiedPurchase(coreAccount.id, accountState as 'direct-free' | 'direct-essential' | 'direct-premium');
  if (accountState === coreAccount.accountState) return { account: coreAccount, verified, readFailed };
  return {
    account: buildAuthUser({
      id: coreAccount.id,
      firstName: coreAccount.firstName,
      lastName: coreAccount.lastName,
      email: coreAccount.email,
      accountState,
      orgId: coreAccount.orgId,
      joinedAt: coreAccount.joinedAt,
      timezone: coreAccount.timezone,
    }),
    verified,
    readFailed,
  };
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
  const [entitlementsSettled, setEntitlementsSettled] = useState(true);
  // The latest entitlements read failed or timed out: re-read with a short
  // backoff and on every return to the foreground until one succeeds.
  const [accountReadFailed, setAccountReadFailed] = useState(false);
  const isOfflineAccountFallbackRef = useRef(false);
  isOfflineAccountFallbackRef.current = isOfflineAccountFallback;
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

  /** Only a verified tier is cached; a fallback tier never overwrites it. */
  const cacheIfVerified = useCallback((authUserId: string, load: AccountLoad) => {
    if (load.verified) queueAccountCacheWrite(authUserId, load.account);
  }, [queueAccountCacheWrite]);

  /** For a failed entitlements read: the tier this same account had in memory, else as last cached. */
  const lastKnownStateFor = useCallback((authUserId: string): LastKnownAccountState => async (accountId) => {
    const inMemory = isOfflineAccountFallbackRef.current ? null : userRef.current;
    const fromMemory = lastKnownDirectState(accountId, [inMemory]);
    if (fromMemory) return fromMemory;
    // Let a queued write land first so the cache holds the latest verified tier.
    await cacheWriteRef.current.catch(() => undefined);
    const cachedState = await readCachedAccountState(authUserId, accountId).catch(() => null);
    return cachedState ? lastKnownDirectState(accountId, [{ id: accountId, accountState: cachedState }]) : null;
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
    if (previousAuthUserId !== sessionUser.id) {
      userRef.current = null;
      setUser(null);
    }

    const generation = ++authGenerationRef.current;
    const requestId = accountRequestGateRef.current.begin();
    authUserRef.current = sessionUser;
    isLoadingRef.current = true;
    setAuthUser(sessionUser);
    setIsLoading(true);
    setEntitlementsSettled(false);
    setAccountReadFailed(false);
    setAccountError(null);
    setIsOfflineAccountFallback(false);
    addAppBreadcrumb('auth.account_bootstrap_started');

    void fetchCoreAccount(sessionUser, lastKnownStateFor(sessionUser.id))
      .then((load) => {
        if (
          authGenerationRef.current !== generation ||
          !accountRequestGateRef.current.isCurrent(requestId) ||
          !load
        ) return;
        const account = load.account;
        userRef.current = account;
        setUser(account);
        setIsOfflineAccountFallback(false);
        isLoadingRef.current = false;
        setIsLoading(false);
        cacheIfVerified(sessionUser.id, load);
        addAppBreadcrumb('auth.account_bootstrap_completed');

        // Optional subscription providers refresh after app entry. They can
        // improve entitlements, but cannot keep a valid user on the login page.
        void enrichAccount(sessionUser, load)
          .then((enrichedLoad) => {
            if (
              authGenerationRef.current !== generation ||
              !accountRequestGateRef.current.isCurrent(requestId)
            ) return;
            const enriched = enrichedLoad.account;
            userRef.current = enriched;
            setUser(enriched);
            setEntitlementsSettled(true);
            setAccountReadFailed(enrichedLoad.readFailed);
            cacheIfVerified(sessionUser.id, enrichedLoad);
            addAppBreadcrumb('auth.account_enrichment_completed');
          })
          .catch((error) => {
            if (
              authGenerationRef.current !== generation ||
              !accountRequestGateRef.current.isCurrent(requestId)
            ) return;
            setEntitlementsSettled(true);
            setAccountReadFailed(load.readFailed);
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
            // The cached profile is all there is until the server is reachable.
            setEntitlementsSettled(true);
            setIsOfflineAccountFallback(true);
            setAccountError(null);
            addAppBreadcrumb('auth.offline_account_fallback_restored', 'warning');
            return;
          }
        }
        // Recheck after the asynchronous cache read, including cache misses.
        if (
          authGenerationRef.current !== generation ||
          !accountRequestGateRef.current.isCurrent(requestId)
        ) return;
        isLoadingRef.current = false;
        setIsLoading(false);
        setEntitlementsSettled(true);
        setIsOfflineAccountFallback(false);
        setAccountError(error instanceof Error ? error.message : 'account_load_failed');
        addAppBreadcrumb('auth.account_bootstrap_failed', 'error');
        captureAppError(error);
      });
  }, [cacheIfVerified, lastKnownStateFor]);

  const refreshAccount = useCallback(async (options?: {
    retainOfflineFallback?: boolean;
    /** Background retry: a failure leaves the account on screen exactly as it is. */
    keepCurrentOnFailure?: boolean;
  }) => {
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
      const load = await fetchCoreAccount(currentAuthUser, lastKnownStateFor(currentAuthUser.id));
      if (
        authGenerationRef.current !== generation ||
        !accountRequestGateRef.current.isCurrent(requestId) ||
        !load
      ) return;
      userRef.current = load.account;
      setUser(load.account);
      setIsOfflineAccountFallback(false);
      isLoadingRef.current = false;
      setIsLoading(false);
      cacheIfVerified(currentAuthUser.id, load);
      const enrichedLoad = await enrichAccount(currentAuthUser, load);
      if (
        authGenerationRef.current === generation &&
        accountRequestGateRef.current.isCurrent(requestId)
      ) {
        userRef.current = enrichedLoad.account;
        setUser(enrichedLoad.account);
        // A refresh supersedes a sign-in enrichment still in flight.
        setEntitlementsSettled(true);
        setAccountReadFailed(enrichedLoad.readFailed);
        cacheIfVerified(currentAuthUser.id, enrichedLoad);
      }
    } catch (error) {
      if (
        authGenerationRef.current === generation &&
        accountRequestGateRef.current.isCurrent(requestId)
      ) {
        setEntitlementsSettled(true);
        // A background retry that cannot reach the account keeps what is shown
        // (never a downgrade, never the offline or error screen).
        if (
          options?.keepCurrentOnFailure
          && userRef.current
          && !isOfflineAccountFallbackRef.current
          && authUserRef.current?.id === currentAuthUser.id
        ) {
          addAppBreadcrumb('auth.account_retry_failed', 'warning');
          throw error;
        }
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
        // Recheck after the asynchronous cache read, including cache misses.
        if (
          authGenerationRef.current !== generation ||
          !accountRequestGateRef.current.isCurrent(requestId)
        ) return;
        // Automatic retries from the offline fallback must not demote a member
        // still showing cached data into a blank account-error state.
        if (options?.retainOfflineFallback && userRef.current && isOfflineAccountFallbackRef.current) {
          addAppBreadcrumb('auth.offline_account_refresh_failed', 'warning');
          throw error;
        }
        isLoadingRef.current = false;
        setIsLoading(false);
        setIsOfflineAccountFallback(false);
        setAccountError(error instanceof Error ? error.message : 'account_load_failed');
        captureAppError(error);
      }
      throw error;
    }
  }, [cacheIfVerified, lastKnownStateFor]);

  const signOutLocally = useCallback(async () => {
    const accountId = userRef.current?.id;
    const authUserId = authUserRef.current?.id ?? null;
    if (!accountId) return;
    await signOutDeviceLocally({ accountId, authUserId }, {
      storePendingRevoke: async (id) => {
        await storePendingPushTokenRevoke(id);
        await stopDevicePushDelivery().catch(captureAppError);
      },
      discardOutbox: (id) => offlineOutbox.clear(id),
      clearOfflineAccount: async (id) => {
        // Finish any older write before clearing so the profile cannot race
        // back onto disk (same rule as the SIGNED_OUT handler).
        await cacheWriteRef.current.catch(() => undefined);
        await (id ? clearOfflineAccount(id) : clearLastOfflineAccount());
      },
      // Emits SIGNED_OUT, so the handler below resets state like a normal sign-out.
      removeSession: () => removeSessionLocally(supabase.auth),
    });
    addAppBreadcrumb('auth.signed_out_locally', 'warning');
  }, []);

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
        if (authGenerationRef.current !== initialGeneration) return;
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
        // completeSignIn dedups same-user events while a cached profile is
        // showing, so a token refresh after connectivity returns must re-fetch
        // explicitly or the offline fallback never recovers.
        if (isOfflineAccountFallbackRef.current && authUserRef.current?.id === session.user.id) {
          void refreshAccount({ retainOfflineFallback: true }).catch(() => undefined);
        } else {
          completeSignIn(session.user);
        }
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
        setEntitlementsSettled(true);
        setAccountReadFailed(false);
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

    return () => {
      subscription.unsubscribe();
      ++authGenerationRef.current;
      accountRequestGateRef.current.invalidate();
      // Permit Strict Mode's effect re-subscription to bootstrap again.
      authUserRef.current = null;
    };
  }, [completeSignIn, refreshAccount]);

  // The offline fallback fails closed only "until the server is reachable
  // again": retry the live account whenever the app returns to the foreground.
  useEffect(() => {
    if (!isOfflineAccountFallback) return;
    const retry = () => {
      if (authUserRef.current) {
        void refreshAccount({ retainOfflineFallback: true }).catch(() => undefined);
        return;
      }
      // getSession itself failed offline; the session was never bootstrapped.
      void supabase.auth.getSession()
        .then(({ data: { session } }) => { if (session) completeSignIn(session.user); })
        .catch(() => undefined);
    };
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') retry();
    });
    return () => subscription.remove();
  }, [isOfflineAccountFallback, refreshAccount, completeSignIn]);

  // A slow or failed entitlements read must not leave a paying member on the
  // free tier for the whole session: re-read with a short backoff and whenever
  // the app returns to the foreground, until a read succeeds.
  useEffect(() => {
    if (!accountReadFailed || isOfflineAccountFallback) return;
    let cancelled = false;
    let inFlight = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      const delay = accountReadRetryDelay(attempt);
      attempt += 1;
      if (delay !== null) timer = setTimeout(retry, delay);
    };
    function retry() {
      if (cancelled || inFlight || !authUserRef.current) return;
      inFlight = true;
      void refreshAccount({ keepCurrentOnFailure: true })
        .catch(() => undefined)
        .finally(() => {
          inFlight = false;
          // Still failing (a success clears accountReadFailed and cancels this).
          if (!cancelled) schedule();
        });
    }
    schedule();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') retry();
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, [accountReadFailed, isOfflineAccountFallback, refreshAccount]);

  const accountState = user?.accountState ?? 'direct-free';
  useEffect(() => {
    setDeviceSignedIn(!!user);
  }, [user]);

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
        entitlementsSettled,
        refreshAccount,
        completeSignIn,
        signOutLocally,
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  return useContext(AccountContext);
}
