import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { AuthUser, AccountState, Entitlements } from '../api/types';
import { supabase } from '../lib/supabase';
import { isAdminEmail } from '../lib/admin';
import { configureRevenueCat, getIsActivePremium, getIsActiveEssential } from '../lib/revenueCat';

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
  isAttached: boolean;
  refreshAccount: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue>({
  user: null,
  accountState: 'direct-free',
  entitlements: DEFAULT_ENTITLEMENTS,
  isLoading: true,
  isAttached: false,
  refreshAccount: async () => {},
});

async function ensureTermsConsent(accountId: string) {
  const { data } = await supabase
    .from('consents')
    .select('id')
    .eq('account_id', accountId)
    .eq('consent_key', '1')
    .maybeSingle();
  if (!data) {
    await supabase.from('consents').insert({
      account_id: accountId,
      consent_key: '1',
      version: '1.0',
      granted_at: new Date().toISOString(),
    });
  }
}

async function fetchAccount(authUser: User): Promise<AuthUser | null> {
  const isAdmin = isAdminEmail(authUser.email);
  const { data, error } = await supabase
    .from('accounts')
    .select('id, type, org_id, first_name, last_name, language, timezone, created_at')
    .eq('user_id', authUser.id)
    .single();

  if (error || !data) {
    if (!isAdmin) return null;

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

  ensureTermsConsent(data.id);

  let accountState: AccountState =
    data.type === 'attached' ? 'attached' : 'direct-free';

  if (data.type === 'direct') {
    if (isAdmin) {
      accountState = 'direct-premium';
    }

    // Sync website ($14.99 family) membership → 'web' entitlement before we
    // read entitlements, so web subscribers unlock Essential on first sign-in.
    // Best-effort: a slow/unreachable bridge never blocks login.
    if (!isAdmin) {
      try {
        await Promise.race([
          supabase.functions.invoke('sync-web-membership'),
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]);
      } catch {
        // Offline or bridge down — fall through to existing entitlements/IAP.
      }
    }

    // Check Supabase entitlements first (coupons + manual grants take priority)
    const { data: ent } = isAdmin ? { data: null } : await supabase
      .from('entitlements')
      .select('tier, expires_at')
      .eq('account_id', data.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (ent) {
      const expired = ent.expires_at ? new Date(ent.expires_at) < new Date() : false;
      if (!expired) {
        if (ent.tier === 'premium') accountState = 'direct-premium';
        else if (ent.tier === 'essential') accountState = 'direct-essential';
      }
    }

    // Check RevenueCat — source of truth for IAP subscriptions
    if (!isAdmin && accountState !== 'direct-premium') {
      configureRevenueCat(data.id);
      const rcPremium = await getIsActivePremium();
      if (rcPremium) {
        accountState = 'direct-premium';
      } else if (accountState === 'direct-free') {
        const rcEssential = await getIsActiveEssential();
        if (rcEssential) accountState = 'direct-essential';
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

  const refreshAccount = useCallback(async () => {
    if (!authUser) return;
    const account = await fetchAccount(authUser);
    setUser(account);
  }, [authUser]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setAuthUser(session.user);
        fetchAccount(session.user).then((account) => {
          setUser(account);
          setIsLoading(false);
        });
      } else {
        setIsLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session) {
          setAuthUser(session.user);
          fetchAccount(session.user).then(setUser);
        } else {
          setAuthUser(null);
          setUser(null);
        }
      },
    );

    return () => subscription.unsubscribe();
  }, []);

  const accountState = user?.accountState ?? 'direct-essential';
  const entitlements = user?.entitlements ?? DEFAULT_ENTITLEMENTS;

  return (
    <AccountContext.Provider
      value={{
        user,
        accountState,
        entitlements,
        isLoading,
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
