import React, { createContext, useContext, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { AuthUser, AccountState, Entitlements } from '../api/types';
import { supabase } from '../lib/supabase';

const DEFAULT_ENTITLEMENTS: Entitlements = {
  canMessageOnCallCoach: false,
  canCallCoach: false,
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
}

const AccountContext = createContext<AccountContextValue>({
  user: null,
  accountState: 'direct-essential',
  entitlements: DEFAULT_ENTITLEMENTS,
  isLoading: true,
  isAttached: false,
});

async function fetchAccount(authUser: User): Promise<AuthUser | null> {
  const { data, error } = await supabase
    .from('accounts')
    .select('id, type, org_id, first_name, last_name, language, timezone, created_at')
    .eq('user_id', authUser.id)
    .single();

  if (error || !data) return null;

  const accountState: AccountState =
    data.type === 'attached' ? 'attached' : 'direct-essential';

  return {
    id: data.id,
    firstName: data.first_name ?? '',
    lastName: data.last_name ?? '',
    email: authUser.email ?? '',
    avatarUrl: null,
    accountState,
    entitlements: DEFAULT_ENTITLEMENTS,
    orgId: data.org_id ?? null,
    branding: null,
    joinedAt: data.created_at,
  };
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
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
          fetchAccount(session.user).then(setUser);
        } else {
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
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount(): AccountContextValue {
  return useContext(AccountContext);
}
