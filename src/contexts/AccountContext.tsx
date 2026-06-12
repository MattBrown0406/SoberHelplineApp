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

// Terms+Privacy consent (#1) must be recorded under an authenticated session.
// Recording it at sign-up fails silently when email confirmation is enabled
// (no session yet → RLS blocks the write), so we ensure it here on every
// authenticated load. Idempotent: skips if the row already exists.
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
  const { data, error } = await supabase
    .from('accounts')
    .select('id, type, org_id, first_name, last_name, language, timezone, created_at')
    .eq('user_id', authUser.id)
    .single();

  if (error || !data) return null;

  ensureTermsConsent(data.id); // fire-and-forget; see note above

  // Resolve accountState: attached accounts set by org; direct accounts check entitlements table
  let accountState: AccountState =
    data.type === 'attached' ? 'attached' : 'direct-essential';

  if (data.type === 'direct') {
    const { data: ent } = await supabase
      .from('entitlements')
      .select('tier, expires_at')
      .eq('account_id', data.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (ent) {
      const expired = ent.expires_at ? new Date(ent.expires_at) < new Date() : false;
      if (!expired && ent.tier === 'premium') accountState = 'direct-premium';
    }
  }

  const entitlements: Entitlements = {
    canMessageOnCallCoach: true,
    canCallCoach: accountState === 'attached' || accountState === 'direct-premium',
    canCallAfterHours: accountState === 'attached',
    canAccessGroups: true,
    canAccessLearningContent: true,
    hasAssignedCoach: accountState === 'attached',
  };

  return {
    id: data.id,
    firstName: data.first_name ?? '',
    lastName: data.last_name ?? '',
    email: authUser.email ?? '',
    avatarUrl: null,
    accountState,
    entitlements,
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
