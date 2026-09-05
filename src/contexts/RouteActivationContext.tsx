import React, { createContext, useContext } from 'react';

// Fail closed outside the root provider. The navigator stays mounted to retain
// cold deep links, but hidden media must not mount effects or request admission.
export const RouteActivationContext = createContext<string | null>(null);

export function RouteActivationGate({ children }: { children: React.ReactNode }) {
  const accountId = useContext(RouteActivationContext);
  if (accountId === null) return null;
  // Account changes reset tokens, errors and teardown refs even if readiness
  // never passes through false. Stable readiness does not remount the child.
  return <React.Fragment key={accountId}>{children}</React.Fragment>;
}
