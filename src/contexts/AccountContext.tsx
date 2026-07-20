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

const DEFAULT_ENTITLEMENTS: Entitlements = {
  canMessageOnCallCoach: false,
  canCallCoach: false,
  canAccessPrivateVideo: false,
  canCallAfterHours: false,
  canAccessGroups: false,
  canAccessLearningContent: true,
  hasAssignedCoach: false,
};

interface AccountContextValue {
  user: AuthUser | null;
  accountState: AccountState;
  entitlements: Entitlements;
  isLoading: boolean;
  isAuthenticated: boolean;
  accountError: string | null;
  isAttached: boolean;
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
  refreshAccount: async () => {},
  completeSignIn: () => {},
});

async function fetchCoreAccount(authUser: User): Promise<AuthUser | null> {
  const isAdmin = isAdminEmail(authUser.email);
  const accountResult = await withTimeoutFallback(
    Promise.resolve(
      supabase
        .from('accounts')
        .select('id, type, org_id, first_name, last_name, language, timezone, created_at')
        .eq('user_id', authUser.id)
        .single(),
    ),
    4000,
    null,
  );
  if (!accountResult) throw new Error('account_load_timeout');
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
      accountState: 'direct-premium',
      orgId: null,
      joinedAt: new Date().toISOString(),
      timezone: 'America/Los_Angeles',
    });
  }

  // Consent persistence is best-effort and must never hold the user on the
  // sign-in screen. The RPC only records affirmative signup metadata.
  void supabase.rpc('record_signup_terms_consent').then(({ error: consentError }) => {
    if (consentError) addAppBreadcrumb('auth.consent_persistence_failed', 'warning');
  });

  let accountState: AccountState = data.type === 'attached' ? 'attached' : 'direct-free';

  if (data.type === 'direct') {
    if (isAdmin) {
      accountState = 'direct-premium';
    } else {
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
  }

  return buildAuthUser({
    id: data.id,
    firstName: data.first_name ?? '',
    lastName: data.last_name ?? '',
    email: authUser.email ?? '',
    accountState,
    orgId: data.org_id ?? null,
    joinedAt: data.created_at,
    timezone: data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
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
}: {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  accountState: AccountState;
  orgId: string | null;
  joinedAt: string;
  timezone: string;
}): AuthUser {
  const isPaid = accountState !== 'direct-free';
  const entitlements: Entitlements = {
    canMessageOnCallCoach: isPaid,
    canCallCoach: accountState === 'attached' || accountState === 'direct-premium',
    canAccessPrivateVideo: accountState === 'attached' || accountState === 'direct-premium',
    canCallAfterHours: accountState === 'attached',
    canAccessGroups: isPaid,
    canAccessLearningContent: true,
    hasAssignedCoach: accountState === 'attached',
  };

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
  const authGenerationRef = useRef(0);
  const accountRequestGateRef = useRef(new AccountRequestGate());
  const authUserRef = useRef<User | null>(null);
  const userRef = useRef<AuthUser | null>(null);
  const isLoadingRef = useRef(true);

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
        isLoadingRef.current = false;
        setIsLoading(false);
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
      .catch((error) => {
        if (
          authGenerationRef.current !== generation ||
          !accountRequestGateRef.current.isCurrent(requestId)
        ) return;
        isLoadingRef.current = false;
        setIsLoading(false);
        setAccountError(error instanceof Error ? error.message : 'account_load_failed');
        addAppBreadcrumb('auth.account_bootstrap_failed', 'error');
        captureAppError(error);
      });
  }, []);

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
      isLoadingRef.current = false;
      setIsLoading(false);
      const enriched = await enrichAccount(currentAuthUser, account);
      if (
        authGenerationRef.current === generation &&
        accountRequestGateRef.current.isCurrent(requestId)
      ) {
        userRef.current = enriched;
        setUser(enriched);
      }
    } catch (error) {
      if (
        authGenerationRef.current === generation &&
        accountRequestGateRef.current.isCurrent(requestId)
      ) {
        isLoadingRef.current = false;
        setIsLoading(false);
        setAccountError(error instanceof Error ? error.message : 'account_load_failed');
        captureAppError(error);
      }
      throw error;
    }
  }, []);

  useEffect(() => {
    const initialGeneration = authGenerationRef.current;
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (authGenerationRef.current !== initialGeneration) return;
      if (session) {
        completeSignIn(session.user);
      } else {
        isLoadingRef.current = false;
        setIsLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        completeSignIn(session.user);
      } else {
        ++authGenerationRef.current;
        accountRequestGateRef.current.invalidate();
        authUserRef.current = null;
        userRef.current = null;
        isLoadingRef.current = false;
        setAuthUser(null);
        setUser(null);
        setAccountError(null);
        setIsLoading(false);
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
        isAuthenticated: authUser !== null,
        accountError,
        isAttached: accountState === 'attached',
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
