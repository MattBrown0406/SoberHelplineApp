import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { AuthUser, AccountState, Entitlements } from '../api/types';
import { supabase } from '../lib/supabase';
import { isAdminEmail } from '../lib/admin';
import { configureRevenueCat, getActiveRevenueCatTier, resetRevenueCatUser } from '../lib/revenueCat';

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
});

async function fetchAccount(authUser: User): Promise<AuthUser | null> {
  const isAdmin = isAdminEmail(authUser.email);
  const { data, error } = await supabase
    .from('accounts')
    .select('id, type, org_id, first_name, last_name, language, timezone, created_at')
    .eq('user_id', authUser.id)
    .single();

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
    });
  }

  // Records only affirmative signup metadata; existing users without that evidence
  // are not backfilled or silently treated as having consented.
  await supabase.rpc('record_signup_terms_consent');

  let accountState: AccountState =
    data.type === 'attached' ? 'attached' : 'direct-free';

  if (data.type === 'direct') {
    const rcReady = await configureRevenueCat(data.id);

    if (isAdmin) {
      accountState = 'direct-premium';
    }

    // Sync external subscriptions → entitlements rows before reading them:
    //  - sync-web-membership: soberhelpline.com $14.99 family members
    //  - sync-iap-entitlements: App Store subscribers (server-verified via the
    //    RevenueCat REST API) — required because DB RLS gates (textline,
    //    private video) can only see the entitlements table, not RevenueCat.
    // Best-effort with a cap: a slow/unreachable bridge never blocks login.
    if (!isAdmin) {
      try {
        await Promise.race([
          Promise.allSettled([
            supabase.functions.invoke('sync-web-membership'),
            supabase.functions.invoke('sync-iap-entitlements'),
          ]),
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]);
      } catch {
        // Offline or bridge down — fall through to existing entitlements/IAP.
      }
    }

    // Resolve all active grants explicitly; Premium always wins over Essential.
    const { data: entitlementRows } = isAdmin ? { data: null } : await supabase
      .from('entitlements')
      .select('tier, expires_at')
      .eq('account_id', data.id);

    const activeTiers = (entitlementRows ?? [])
      .filter((ent) => !ent.expires_at || new Date(ent.expires_at) >= new Date())
      .map((ent) => ent.tier);
    if (activeTiers.includes('premium')) accountState = 'direct-premium';
    else if (activeTiers.includes('essential')) accountState = 'direct-essential';

    // Check RevenueCat — source of truth for IAP subscriptions.
    // Identity was established before server synchronization above.
    if (!isAdmin && rcReady) {
      const rcTier = await getActiveRevenueCatTier();
      if (rcTier === 'premium') {
        accountState = 'direct-premium';
      } else if (accountState === 'direct-free' && rcTier === 'essential') {
        accountState = 'direct-essential';
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
}: {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  accountState: AccountState;
  orgId: string | null;
  joinedAt: string;
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
  };
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const authGenerationRef = useRef(0);

  const refreshAccount = useCallback(async () => {
    if (!authUser) return;
    const generation = authGenerationRef.current;
    setAccountError(null);
    try {
      const account = await fetchAccount(authUser);
      if (authGenerationRef.current === generation) setUser(account);
    } catch (error) {
      if (authGenerationRef.current === generation) {
        setAccountError(error instanceof Error ? error.message : 'account_load_failed');
      }
      throw error;
    }
  }, [authUser]);

  useEffect(() => {
    function loadSessionUser(sessionUser: User) {
      const generation = ++authGenerationRef.current;
      setAuthUser(sessionUser);
      setIsLoading(true);
      setAccountError(null);
      void fetchAccount(sessionUser)
        .then((account) => {
          if (authGenerationRef.current !== generation) return;
          setUser(account);
        })
        .catch((error) => {
          if (authGenerationRef.current !== generation) return;
          setAccountError(error instanceof Error ? error.message : 'account_load_failed');
        })
        .finally(() => {
          if (authGenerationRef.current === generation) setIsLoading(false);
        });
    }

    const initialGeneration = authGenerationRef.current;
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (authGenerationRef.current !== initialGeneration) return;
      if (session) {
        loadSessionUser(session.user);
      } else {
        setIsLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session) {
          loadSessionUser(session.user);
        } else {
          ++authGenerationRef.current;
          setAuthUser(null);
          setUser(null);
          setAccountError(null);
          setIsLoading(false);
          void resetRevenueCatUser();
        }
      },
    );

    return () => subscription.unsubscribe();
  }, []);

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
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  return useContext(AccountContext);
}
