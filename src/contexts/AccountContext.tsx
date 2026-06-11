import React, { createContext, useContext, useEffect, useState } from 'react';
import type { AuthUser, AccountState, Entitlements } from '../api/types';
import { getMockAuthUser } from '../api/mock';

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

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // TODO: replace with real token check + GET /me
    const mockUser = getMockAuthUser();
    setUser(mockUser);
    setIsLoading(false);
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
